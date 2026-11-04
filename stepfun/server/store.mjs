import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

const SEARCH_INCLUDE = ["documents", "metadatas", "distances"];
const NAMES_FILE = () => path.join(config.dataDir, "collection-names.json");

function flatten(result) {
  const ids = result?.ids?.[0] ?? [];
  const documents = result?.documents?.[0] ?? [];
  const metadatas = result?.metadatas?.[0] ?? [];
  const distances = result?.distances?.[0] ?? [];
  return ids.map((id, index) => ({
    id,
    text: documents[index] ?? "",
    metadata: metadatas[index] ?? {},
    distance: typeof distances[index] === "number" ? distances[index] : null,
    rank: index + 1,
  }));
}

export class KnowledgeStore {
  constructor(client, logger = console) {
    this.client = client;
    this.logger = logger;
    this._cache = new Map();
    this._names = this._readNames();
  }

  _readNames() {
    try {
      return JSON.parse(fs.readFileSync(NAMES_FILE(), "utf8"));
    } catch {
      return {};
    }
  }

  _saveNames() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(NAMES_FILE(), JSON.stringify(this._names, null, 2));
    } catch (error) {
      this.logger.warn("[store] 保存知识库名称失败", error.message);
    }
  }

  rename(id, name) {
    this._names[id] = String(name || "").slice(0, 60) || "未命名知识库";
    this._saveNames();
  }

  async collection(id) {
    if (!id || !id.startsWith(config.collectionPrefix)) {
      throw Object.assign(new Error("无效的知识库 ID"), { status: 400 });
    }
    if (!this._cache.has(id)) {
      try {
        const col = await this.client.getCollection({ name: id, embeddingFunction: null });
        this._cache.set(id, col);
      } catch (error) {
        throw Object.assign(new Error(`知识库不存在：${id}`), { status: 404, cause: error });
      }
    }
    return this._cache.get(id);
  }

  async list() {
    // 说明：seekdb-js 1.4.0 的 listCollections() 在当前服务端版本上会返回空数组，
    // 但 sdk_collections 元数据表是可查询的，因此直接读该表，保证 UI 能看到已建知识库。
    let names = [];
    try {
      const rows = await this.client.execute("SELECT collection_name FROM sdk_collections");
      names = (rows ?? [])
        .map((row) => row.collection_name)
        .filter((name) => typeof name === "string" && name.startsWith(config.collectionPrefix));
    } catch {
      const collections = await this.client.listCollections();
      names = collections.map((item) => item.name).filter((name) => name?.startsWith(config.collectionPrefix));
    }
    const rows = await Promise.all(
      names.map(async (name) => {
        try {
          const col = await this.collection(name);
          const count = await col.count();
          return {
            id: name,
            name: this._names[name] || null,
            chunks: count,
            dimension: col.dimension,
            distance: col.distance,
          };
        } catch {
          return { id: name, name: this._names[name] || null, chunks: null, dimension: config.dimension, distance: "cosine" };
        }
      }),
    );
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  async create(displayName = "新的知识库") {
    const suffix = crypto.randomBytes(4).toString("hex");
    const id = `${config.collectionPrefix}${Date.now().toString(36)}${suffix}`;
    await this.client.createCollection({
      name: id,
      embeddingFunction: null,
      configuration: {
        hnsw: { dimension: config.dimension, distance: "cosine" },
        // 中文没有空格分词，使用 2-gram 全文索引；查询词在 seekdb 内部完成分词与打分
        fulltextConfig: { analyzer: "ngram", properties: { ngram_token_size: 2 } },
      },
    });
    this._cache.delete(id);
    this._names[id] = displayName;
    this._saveNames();
    this.logger.log(`[store] 创建知识库 ${id} (${displayName})`);
    return { id, name: displayName, chunks: 0, dimension: config.dimension };
  }

  async remove(id) {
    await this.collection(id);
    await this.client.deleteCollection(id);
    this._cache.delete(id);
    delete this._names[id];
    this._saveNames();
  }

  async addItems(id, items, { refresh = false } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw Object.assign(new Error("没有可写入的向量"), { status: 400 });
    }
    for (const item of items) {
      if (!item?.id || typeof item.text !== "string") {
        throw Object.assign(new Error("写入项缺少 id/text"), { status: 400 });
      }
      if (!Array.isArray(item.embedding) || item.embedding.length !== config.dimension) {
        throw Object.assign(
          new Error(`向量维度错误：期望 ${config.dimension}，实际 ${item.embedding?.length ?? 0}`),
          { status: 400 },
        );
      }
    }
    const col = await this.collection(id);
    const writeStart = performance.now();
    await col.upsert({
      ids: items.map((item) => item.id),
      documents: items.map((item) => item.text),
      embeddings: items.map((item) => item.embedding),
      metadatas: items.map((item) => ({
        docId: String(item.metadata?.docId ?? ""),
        title: String(item.metadata?.title ?? ""),
        source: String(item.metadata?.source ?? ""),
        chunk: Number(item.metadata?.chunk ?? 0),
        totalChunks: Number(item.metadata?.totalChunks ?? 1),
        chars: Number(item.metadata?.chars ?? item.text.length),
      })),
    });
    const writeMs = performance.now() - writeStart;

    let refreshMs = 0;
    if (refresh) {
      const refreshStart = performance.now();
      await col.refresh_index();
      refreshMs = performance.now() - refreshStart;
    }
    return { written: items.length, writeMs, refreshMs, refreshed: refresh };
  }

  async refresh(id) {
    const col = await this.collection(id);
    const start = performance.now();
    await col.refresh_index();
    return { refreshMs: performance.now() - start, chunks: await col.count() };
  }

  async search(id, { query = "", embedding, topK = 8, mode = "hybrid" } = {}) {
    const col = await this.collection(id);
    const k = Math.max(1, Math.min(50, Number(topK) || 8));
    const trimmed = String(query ?? "").trim();
    const start = performance.now();
    let raw;

    if (mode === "vector" || !trimmed) {
      if (!Array.isArray(embedding) || embedding.length !== config.dimension) {
        throw Object.assign(new Error("查询向量缺失或维度不正确"), { status: 400 });
      }
      raw = await col.query({
        queryEmbeddings: embedding,
        nResults: k,
        include: SEARCH_INCLUDE,
      });
    } else if (mode === "fulltext") {
      raw = await col.hybridSearch({
        query: { whereDocument: { $contains: trimmed }, nResults: k },
        nResults: k,
        include: SEARCH_INCLUDE,
      });
    } else {
      if (!Array.isArray(embedding) || embedding.length !== config.dimension) {
        throw Object.assign(new Error("查询向量缺失或维度不正确"), { status: 400 });
      }
      // 混合检索完全下推到 seekdb：全文条件 + 向量 KNN，由数据库用 RRF 融合排序，
      // 客户端不做两路结果拼接。
      raw = await col.hybridSearch({
        query: { whereDocument: { $contains: trimmed }, nResults: Math.max(k * 3, 20) },
        knn: { queryEmbeddings: embedding, nResults: Math.max(k * 3, 20) },
        rank: { rrf: { rankWindowSize: 60, rankConstant: 60 } },
        nResults: k,
        include: SEARCH_INCLUDE,
      });
    }

    const searchMs = performance.now() - start;
    const results = flatten(raw).map((hit) => {
      if (mode === "vector" && hit.distance !== null) {
        return { ...hit, similarity: Math.max(-1, Math.min(1, 1 - hit.distance)) };
      }
      return hit;
    });
    return { results, searchMs, mode: trimmed ? mode : "vector", topK: k };
  }

  async preview(id, limit = 20) {
    const col = await this.collection(id);
    const raw = await col.get({ limit, include: ["documents", "metadatas"] });
    return flatten(raw);
  }
}

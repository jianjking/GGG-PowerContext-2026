import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ImportPanel from "./components/ImportPanel.jsx";
import SearchPanel from "./components/SearchPanel.jsx";
import BenchmarkPanel from "./components/BenchmarkPanel.jsx";
import { Badge, Empty } from "./components/ui.jsx";
import { useEmbedder } from "./lib/embedder-client.js";
import { api } from "./lib/api.js";
import { chunkRecords } from "@shared/text.mjs";
import { median, p95 } from "./lib/format.js";

const STORE_NAMES = "stepfun.kb.names";
const STORE_ACTIVE = "stepfun.kb.active";

function readNames() {
  try {
    return JSON.parse(localStorage.getItem(STORE_NAMES) || "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const forceBackend = new URLSearchParams(location.search).get("backend") || undefined;
  const { client, status } = useEmbedder(forceBackend);

  const [health, setHealth] = useState({ phase: "starting" });
  const [config, setConfig] = useState(null);
  const [collections, setCollections] = useState([]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(STORE_ACTIVE) || null);
  const [names, setNames] = useState(readNames);
  const [tab, setTab] = useState("kb");
  const [busy, setBusy] = useState(null);
  const [lastImport, setLastImport] = useState(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [topK, setTopK] = useState(8);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchResult, setBenchResult] = useState(null);
  const [quality, setQuality] = useState(null);
  const [samples, setSamples] = useState([]);
  const [evalSet, setEvalSet] = useState(null);
  const [toast, setToast] = useState(null);
  const [saved, setSaved] = useState(false);
  const loadedRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const notify = useCallback((message, tone = "info") => {
    setToast({ message, tone, id: Date.now() });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshCollections = useCallback(async () => {
    const data = await api.collections();
    setCollections(data.collections);
    setNames((previous) => {
      const merged = { ...previous };
      for (const collection of data.collections) {
        if (collection.name && !merged[collection.id]) merged[collection.id] = collection.name;
      }
      return merged;
    });
    setActiveId((previous) => {
      if (previous && data.collections.some((item) => item.id === previous)) return previous;
      return data.collections[0]?.id ?? null;
    });
    return data.collections;
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      try {
        const next = await api.health();
        if (!alive) return;
        setHealth(next);
        if (next.ok && !loadedRef.current) {
          loadedRef.current = true;
          refreshCollections().catch(() => {});
        }
        if (!next.ok) timer = window.setTimeout(tick, 2500);
      } catch (error) {
        if (!alive) return;
        setHealth({ phase: "offline", error: error.message });
        timer = window.setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshCollections]);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    api.quality().then(setQuality).catch(() => {});
    api.samples().then((data) => setSamples(data.docs || [])).catch(() => {});
    api.evalSet().then((data) => setEvalSet(data)).catch(() => {});
    api.bench().then((data) => {
      if (data?.runs?.length) setBenchResult(data.runs[data.runs.length - 1]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_NAMES, JSON.stringify(names));
  }, [names]);

  useEffect(() => {
    if (activeId) localStorage.setItem(STORE_ACTIVE, activeId);
    setSearchResult(null);
  }, [activeId]);

  const activeName =
    names[activeId] || collections.find((item) => item.id === activeId)?.name || (activeId ? "知识库" : "");

  const createCollection = useCallback(
    async (name = "新的知识库") => {
      const created = await api.createCollection(name);
      setNames((previous) => ({ ...previous, [created.id]: name }));
      await refreshCollections();
      setActiveId(created.id);
      return created.id;
    },
    [refreshCollections],
  );

  const deleteCollection = useCallback(
    async (id) => {
      if (!window.confirm("确定删除该知识库及其全部向量？此操作不可恢复。")) return;
      try {
        await api.deleteCollection(id);
        setNames((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });
        if (activeId === id) setActiveId(null);
        await refreshCollections();
        notify("知识库已删除");
      } catch (error) {
        notify(error.message, "error");
      }
    },
    [activeId, refreshCollections, notify],
  );

  const importDocs = useCallback(
    async (docs, options = {}) => {
      const usable = docs.filter((doc) => String(doc.content || "").trim());
      if (!usable.length) return;
      if (statusRef.current?.phase !== "ready") {
        notify("模型尚未加载完成，请稍候再导入", "error");
        return;
      }
      try {
        setBusy({ phase: "chunking", value: 0.05 });
        let targetId = activeId;
        if (!targetId) {
          const defaultName =
            options.name ||
            (usable.length > 1 ? "我的文档知识库" : String(usable[0].title || "我的知识库").slice(0, 20));
          targetId = await createCollection(defaultName);
        }

        const chunks = usable.flatMap((doc) => chunkRecords(doc));
        if (!chunks.length) throw new Error("文档内容为空或无法切分");

        setBusy({ phase: "embedding", done: 0, total: chunks.length, value: 0 });
        const embedded = await client.embed(
          chunks.map((chunk) => chunk.text),
          {
            batchSize: 8,
            onProgress: (done, total) => setBusy({ phase: "embedding", done, total, value: total ? done / total : 0 }),
          },
        );

        setBusy({ phase: "writing", done: 0, total: chunks.length, value: 0 });
        let writeMs = 0;
        const batchSize = 32;
        for (let start = 0; start < chunks.length; start += batchSize) {
          const slice = chunks.slice(start, start + batchSize);
          const items = slice.map((chunk, offset) => ({
            id: chunk.id,
            text: chunk.text,
            embedding: embedded.vectors[start + offset],
            metadata: {
              docId: chunk.docId,
              title: chunk.title,
              source: chunk.source,
              chunk: chunk.chunk,
              totalChunks: chunk.totalChunks,
              chars: chunk.chars,
            },
          }));
          const result = await api.importItems(targetId, items, false);
          writeMs += result.writeMs;
          setBusy({
            phase: "writing",
            done: Math.min(chunks.length, start + slice.length),
            total: chunks.length,
            value: (start + slice.length) / chunks.length,
          });
        }

        setBusy({ phase: "refreshing", value: 0.96 });
        const refresh = await api.refresh(targetId);
        setLastImport({
          docs: usable.length,
          chunks: chunks.length,
          embedMs: embedded.ms,
          writeMs,
          refreshMs: refresh.refreshMs,
          batchSize: 8,
        });
        await refreshCollections();
        setActiveId(targetId);
        setBusy(null);
        notify(`已导入 ${usable.length} 篇文档 / ${chunks.length} 个向量块`);
      } catch (error) {
        setBusy(null);
        notify(error.message, "error");
      }
    },
    [activeId, client, createCollection, notify, refreshCollections],
  );

  const importText = useCallback(
    (doc) => importDocs([{ ...doc, id: `manual-${Date.now()}`, source: "手动粘贴" }]),
    [importDocs],
  );

  const importFiles = useCallback(
    async (files) => {
      const docs = [];
      for (const file of files.slice(0, 20)) {
        if (file.size > 2 * 1024 * 1024) {
          notify(`${file.name} 超过 2 MB，已跳过`, "error");
          continue;
        }
        const content = await file.text();
        docs.push({
          id: `file-${file.name.replace(/\.[^.]+$/, "")}-${file.lastModified}`,
          title: file.name.replace(/\.[^.]+$/, ""),
          content,
          source: file.name,
        });
      }
      await importDocs(docs);
    },
    [importDocs, notify],
  );

  const loadSamples = useCallback(async () => {
    if (!samples.length) {
      notify("示例语料尚未加载", "error");
      return;
    }
    await importDocs(samples, { name: "端侧 AI 知识库" });
  }, [importDocs, notify, samples]);

  const runSearch = useCallback(
    async (rawQuery = query) => {
      const text = String(rawQuery || "").trim();
      if (!text) return null;
      if (!activeId) {
        notify("请先导入语料或创建知识库", "error");
        return null;
      }
      if (statusRef.current?.phase !== "ready" && mode !== "fulltext") {
        notify("模型尚未加载完成", "error");
        return null;
      }
      setSearching(true);
      try {
        const started = performance.now();
        let embedding = null;
        let embedMs = 0;
        if (mode !== "fulltext") {
          const encoded = await client.embed([text], { batchSize: 1 });
          embedding = encoded.vectors[0];
          embedMs = encoded.ms;
        }
        const response = await api.search(activeId, { query: text, embedding, topK, mode });
        const totalMs = performance.now() - started;
        const next = {
          ...response,
          query: text,
          embedMs,
          totalMs,
          backend: statusRef.current?.backend,
          dtype: statusRef.current?.dtype,
          at: Date.now(),
        };
        setSearchResult(next);
        return next;
      } catch (error) {
        notify(error.message, "error");
        return null;
      } finally {
        setSearching(false);
      }
    },
    [activeId, client, mode, notify, query, topK],
  );

  const runBenchmark = useCallback(
    async ({ rounds = 3, limit = 8 } = {}) => {
      if (!activeId) {
        notify("请先导入语料再运行基准", "error");
        return null;
      }
      if (statusRef.current?.phase !== "ready" || !health?.ok) {
        notify("模型或 seekdb 尚未就绪", "error");
        return null;
      }
      const queries = (evalSet?.queries || []).slice(0, limit);
      if (!queries.length) {
        notify("评测集尚未加载", "error");
        return null;
      }
      setBenchRunning(true);
      setSaved(false);
      try {
        await client.embed([queries[0].q], { batchSize: 1 });
        const raw = [];
        for (let round = 0; round < rounds; round++) {
          for (const item of queries) {
            const started = performance.now();
            const encoded = await client.embed([item.q], { batchSize: 1 });
            const response = await api.search(activeId, {
              query: item.q,
              embedding: encoded.vectors[0],
              topK: 8,
              mode: "hybrid",
            });
            const totalMs = performance.now() - started;
            raw.push({
              round,
              query: item.q,
              embedMs: encoded.ms,
              searchMs: response.searchMs,
              totalMs,
              hits: response.results.length,
            });
          }
        }
        const values = (key) => raw.map((item) => item[key]);
        const result = {
          app: "stepfun-edge-kb",
          timestamp: new Date().toISOString(),
          backend: statusRef.current?.backend,
          dtype: statusRef.current?.dtype,
          threads: statusRef.current?.threads ?? null,
          modelLoadMs: statusRef.current?.loadMs,
          modelTotalLoadMs: statusRef.current?.totalMs,
          rounds,
          queries: queries.length,
          topK: 8,
          mode: "hybrid",
          metrics: {
            embedMs: { median: median(values("embedMs")), p95: p95(values("embedMs")) },
            searchMs: { median: median(values("searchMs")), p95: p95(values("searchMs")) },
            e2eMs: { median: median(values("totalMs")), p95: p95(values("totalMs")) },
          },
          import: lastImport,
          raw,
        };
        setBenchResult(result);
        window.__benchResult = result;
        try {
          await api.saveBench(result);
          setSaved(true);
        } catch {}
        notify("基准测试完成");
        return result;
      } catch (error) {
        notify(error.message, "error");
        return null;
      } finally {
        setBenchRunning(false);
      }
    },
    [activeId, client, evalSet, health?.ok, lastImport, notify],
  );

  const ready = status?.phase === "ready" && health?.ok;

  useEffect(() => {
    window.__KB__ = {
      get ready() {
        return statusRef.current?.phase === "ready" && health?.ok;
      },
      status: statusRef.current,
      health,
      collections,
      activeId,
      busy,
      samples,
      searching,
      searchResult,
      loadSamples,
      importDocs,
      runSearch,
      runBenchmark,
      embed: (texts, options) => client.embed(texts, options),
      api,
    };
  }, [activeId, busy, collections, health, loadSamples, runBenchmark, runSearch, samples, searchResult, searching, status]);

  return (
    <div className="app">
      <Header status={status} health={health} model={config} />
      <div className="layout">
        <Sidebar
          collections={collections}
          activeId={activeId}
          names={names}
          health={health}
          status={status}
          onSelect={setActiveId}
          onCreate={() => createCollection(`知识库 ${collections.length + 1}`).catch((error) => notify(error.message, "error"))}
          onDelete={deleteCollection}
        />

        <main className="content">
          <div className="content-top">
            <div className="tabs">
              <button className={tab === "kb" ? "is-active" : ""} onClick={() => setTab("kb")}>
                知识库
              </button>
              <button className={tab === "bench" ? "is-active" : ""} onClick={() => setTab("bench")}>
                性能与质量
                {quality ? <span className="tab-dot" /> : null}
              </button>
            </div>
            <div className="content-hint">
              {ready ? (
                <>
                  <Badge tone="green">端到端就绪</Badge>
                  <span>{collections.length} 个知识库 · {collections.reduce((sum, item) => sum + (item.chunks || 0), 0)} 个向量块</span>
                </>
              ) : (
                <Badge tone="amber">{health.phase === "error" ? "seekdb 启动失败" : "正在准备本地运行时"}</Badge>
              )}
            </div>
          </div>

          {health.phase === "error" ? (
            <div className="banner banner-error">
              <strong>seekdb 启动失败</strong>
              <span>{health.error}</span>
              <code>查看 {health.seekdb?.dataDir || ".data/seekdb"}/log/seekdb.log</code>
            </div>
          ) : null}

          {health.phase === "offline" ? (
            <div className="banner banner-error">
              <strong>无法连接本地 API</strong>
              <span>{health.error}</span>
              <code>请确认已运行 npm run dev（API 端口 8787）</code>
            </div>
          ) : null}

          {health.phase !== "ready" && health.phase !== "error" && health.phase !== "offline" ? (
            <div className="banner banner-info">
              <strong>正在启动本地 seekdb</strong>
              <span>首次初始化需要 1-3 分钟；之后会复用 .data/seekdb，启动只需数秒。</span>
            </div>
          ) : null}

          {tab === "kb" ? (
            <>
              {collections.length === 0 ? (
                <section className="hero">
                  <div>
                    <div className="hero-kicker">PRIVATE · LOCAL · HYBRID</div>
                    <h1>
                      把文档留在你的浏览器里，
                      <br />
                      用 seekdb 找回它们。
                    </h1>
                    <p>
                      导入语料 → 浏览器内向量化 → 写入 seekdb → 向量 + 全文混合检索。
                      模型推理不离开本机，检索排序在数据库内完成。
                    </p>
                    <div className="hero-steps">
                      <div>
                        <span>01</span>
                        浏览器加载 INT8 / FP16 模型
                      </div>
                      <div>
                        <span>02</span>
                        文档与查询本地编码
                      </div>
                      <div>
                        <span>03</span>
                        seekdb RRF 融合排序
                      </div>
                    </div>
                  </div>
                  <div className="hero-orbit" aria-hidden="true">
                    <div className="orbit orbit-1" />
                    <div className="orbit orbit-2" />
                    <div className="orbit orbit-3" />
                    <div className="orbit-core">512d</div>
                  </div>
                </section>
              ) : null}

              <ImportPanel
                busy={busy}
                lastImport={lastImport}
                sampleCount={samples.length || 12}
                disabled={!ready}
                onImportText={importText}
                onImportFiles={importFiles}
                onLoadSamples={loadSamples}
              />

              {collections.length === 0 ? (
                <div className="welcome-note">
                  <Empty icon="⌁" title="还没有可检索的内容">
                    点击“载入示例语料”快速体验完整链路，或拖入自己的 .md / .txt 文档。
                  </Empty>
                </div>
              ) : (
                <SearchPanel
                  query={query}
                  setQuery={setQuery}
                  mode={mode}
                  setMode={setMode}
                  topK={topK}
                  setTopK={setTopK}
                  onSearch={() => runSearch()}
                  searching={searching}
                  result={searchResult}
                  activeName={activeName}
                  ready={ready}
                />
              )}
            </>
          ) : (
            <BenchmarkPanel
              status={status}
              health={health}
              config={config}
              lastImport={lastImport}
              result={benchResult}
              running={benchRunning}
              quality={quality}
              onRun={() => runBenchmark({ rounds: 3, limit: 8 })}
              saved={saved}
            />
          )}

          <footer className="page-foot">
            <span>端侧 AI 推理性能优化与 seekdb 混合检索 · 阶跃星辰赛题</span>
            <span>Transformers.js · ONNX Runtime Web · seekdb 1.4</span>
          </footer>
        </main>
      </div>

      {toast ? <div className={`toast toast-${toast.tone}`}>{toast.message}</div> : null}
    </div>
  );
}

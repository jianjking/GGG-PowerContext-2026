import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config, readJson } from "./config.mjs";
import { startSeekdb } from "./seekdb-service.mjs";
import { KnowledgeStore } from "./store.mjs";

const app = express();
const state = {
  phase: "starting",
  error: null,
  db: null,
  store: null,
  startedAt: Date.now(),
};

app.disable("x-powered-by");
app.use(express.json({ limit: "64mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  // 多线程 WASM 需要 crossOriginIsolated
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireReady(req, res, next) {
  if (state.phase !== "ready") {
    return res.status(503).json({
      error: state.phase === "error" ? state.error : "seekdb 正在启动，请稍候",
      phase: state.phase,
    });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: state.phase === "ready",
    phase: state.phase,
    error: state.error,
    startedAt: state.startedAt,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    seekdb: state.db
      ? {
          mode: "local-server",
          host: "127.0.0.1",
          port: state.db.port,
          dataDir: config.dataDir,
          reused: state.db.reused,
          version: "seekdb 1.4.0 (OceanBase 4.3.5.3)",
        }
      : null,
    model: {
      id: config.modelId,
      name: config.modelName,
      source: config.modelSource,
      dimension: config.dimension,
    },
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    modelId: config.modelId,
    modelName: config.modelName,
    dimension: config.dimension,
    backendPolicy: config.backendPolicy,
    quantization: {
      webgpu: { dtype: "fp16", file: "onnx/model_fp16.onnx", bytes: 47497427 },
      wasm: { dtype: "q8", file: "onnx/model_quantized.onnx", bytes: 24010842 },
      baseline: { dtype: "fp32", file: "onnx/model.onnx", bytes: 94851877 },
    },
  });
});

app.get(
  "/api/collections",
  requireReady,
  asyncRoute(async (req, res) => {
    res.json({ collections: await state.store.list() });
  }),
);

app.post(
  "/api/collections",
  requireReady,
  asyncRoute(async (req, res) => {
    const name = String(req.body?.name ?? "").slice(0, 60) || "新的知识库";
    res.json(await state.store.create(name));
  }),
);

app.delete(
  "/api/collections/:id",
  requireReady,
  asyncRoute(async (req, res) => {
    await state.store.remove(req.params.id);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/collections/:id/import",
  requireReady,
  asyncRoute(async (req, res) => {
    const result = await state.store.addItems(req.params.id, req.body?.items, {
      refresh: Boolean(req.body?.refresh),
    });
    res.json(result);
  }),
);

app.post(
  "/api/collections/:id/refresh",
  requireReady,
  asyncRoute(async (req, res) => {
    res.json(await state.store.refresh(req.params.id));
  }),
);

app.post(
  "/api/collections/:id/search",
  requireReady,
  asyncRoute(async (req, res) => {
    const { query, embedding, topK, mode } = req.body ?? {};
    const result = await state.store.search(req.params.id, { query, embedding, topK, mode });
    res.json(result);
  }),
);

app.get(
  "/api/collections/:id/preview",
  requireReady,
  asyncRoute(async (req, res) => {
    res.json({ items: await state.store.preview(req.params.id, Number(req.query.limit) || 20) });
  }),
);

app.get("/api/samples", (req, res) => {
  const corpus = readJson(config.corpusPath);
  if (!corpus) return res.status(404).json({ error: "示例语料不存在" });
  res.json(corpus);
});

app.get("/api/eval", (req, res) => {
  const data = readJson(config.evalPath);
  if (!data) return res.status(404).json({ error: "评测集不存在" });
  res.json(data);
});

app.get("/api/quality", (req, res) => {
  const data = readJson(path.join(config.benchDir, "quality.json"));
  if (!data) return res.status(404).json({ error: "尚未生成质量评测报告" });
  res.json(data);
});

app.get("/api/bench", (req, res) => {
  const data = readJson(path.join(config.benchDir, "browser-results.json"), { runs: [] });
  res.json(Array.isArray(data?.runs) ? data : { runs: [data] });
});

app.post(
  "/api/bench",
  asyncRoute(async (req, res) => {
    fs.mkdirSync(config.benchDir, { recursive: true });
    const file = path.join(config.benchDir, "browser-results.json");
    const existing = readJson(file, { runs: [] });
    const runs = Array.isArray(existing?.runs) ? existing.runs : existing?.timestamp ? [existing] : [];
    runs.push({ ...req.body, savedAt: new Date().toISOString(), server: { port: state.db?.port } });
    fs.writeFileSync(file, JSON.stringify({ runs }, null, 2));
    res.json({ ok: true, file, runs: runs.length });
  }),
);

// 生产模式：由同一个 Node 进程托管构建后的前端
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { setHeaders: (res) => res.setHeader("Cross-Origin-Embedder-Policy", "require-corp") }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.webDist, "index.html")));
}

app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status >= 500) console.error("[api]", error);
  res.status(status).json({ error: error.message || "服务器错误" });
});

const server = app.listen(config.serverPort, "127.0.0.1", () => {
  console.log(`\n  端侧知识库 API  http://127.0.0.1:${config.serverPort}`);
  if (!fs.existsSync(config.webDist)) {
    console.log(`  开发模式：请另开终端运行 npm run dev（Vite: 5173）\n`);
  }
});

async function boot() {
  try {
    const db = await startSeekdb({
      dataDir: config.dataDir,
      preferredPort: config.seekdbPort,
      startupTimeoutMs: Number(process.env.SEEKDB_STARTUP_TIMEOUT || 300000),
    });
    state.db = db;
    state.store = new KnowledgeStore(db.client);
    state.phase = "ready";
    console.log("[api] seekdb 就绪，REST API 可用");
  } catch (error) {
    state.phase = "error";
    state.error = error.message;
    console.error("[api] seekdb 启动失败：", error);
  }
}

boot();

async function shutdown(signal) {
  console.log(`\n[api] 收到 ${signal}，正在关闭...`);
  server.close();
  try {
    await state.db?.close?.();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

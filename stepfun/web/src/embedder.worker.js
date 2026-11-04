/* global self, navigator */
import { AutoModel, AutoTokenizer, env } from "@huggingface/transformers";

const MODEL_ID = "bge-small-zh-v1.5";
const ORIGIN = self.location.origin;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = `${ORIGIN}/ort/`;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;

let tokenizer = null;
let model = null;
let backend = null;
let dtype = null;

function post(message) {
  self.postMessage(message);
}

async function load(device, precision) {
  const started = performance.now();
  const progress_callback = (info) => {
    if (info?.status === "progress" || info?.status === "download") {
      post({
        type: "load-progress",
        backend: device,
        dtype: precision,
        file: info.file,
        progress: info.progress ?? null,
        loaded: info.loaded ?? null,
        total: info.total ?? null,
      });
    }
  };
  const tok = await AutoTokenizer.from_pretrained(MODEL_ID, {
    local_files_only: true,
    progress_callback,
  });
  const net = await AutoModel.from_pretrained(MODEL_ID, {
    device,
    dtype: precision,
    local_files_only: true,
    progress_callback,
  });

  const encode = async (texts) => {
    const inputs = tok(texts, { padding: true, truncation: true });
    const outputs = await net(inputs);
    let hidden = outputs.last_hidden_state ?? outputs.logits ?? outputs.token_embeddings;
    if (!hidden) throw new Error("模型没有返回 last_hidden_state");
    // bge 系列使用 CLS pooling，再做 L2 归一化，与 cosine 距离配合
    const cls = hidden.slice(null, 0);
    const normalized = cls.normalize(2, -1);
    return normalized.tolist();
  };

  const warm = await encode(["warmup"]);
  const dim = warm?.[0]?.length ?? 0;
  if (!dim) throw new Error("模型热身失败：未获得向量输出");
  return { tokenizer: tok, model: net, encode, loadMs: performance.now() - started, dim };
}

async function init({ forceBackend } = {}) {
  const started = performance.now();
  let webgpuError = null;
  const gpuAvailable = forceBackend !== "wasm" && Boolean(navigator.gpu);

  if (gpuAvailable) {
    try {
      post({ type: "status", phase: "detecting", message: "检测到 WebGPU，正在加载 FP16 模型…" });
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("navigator.gpu.requestAdapter() 返回空");
      const loaded = await load("webgpu", "fp16");
      tokenizer = loaded.tokenizer;
      model = loaded.model;
      backend = "webgpu";
      dtype = "fp16";
      post({
        type: "ready",
        backend,
        dtype,
        dim: loaded.dim,
        loadMs: loaded.loadMs,
        totalMs: performance.now() - started,
        reason: null,
      });
      return;
    } catch (error) {
      webgpuError = error?.message || String(error);
      post({
        type: "fallback",
        reason: webgpuError,
        message: "WebGPU 初始化失败，自动降级到 WASM + INT8",
      });
      try {
        await model?.dispose?.();
      } catch {}
      model = null;
      tokenizer = null;
    }
  } else if (forceBackend === "wasm") {
    post({ type: "status", phase: "detecting", message: "已指定 WASM 后端" });
  } else {
    post({ type: "fallback", reason: "浏览器未提供 navigator.gpu", message: "当前环境不支持 WebGPU，自动降级到 WASM + INT8" });
  }

  try {
    env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
    const loaded = await load("wasm", "q8");
    tokenizer = loaded.tokenizer;
    model = loaded.model;
    backend = "wasm";
    dtype = "q8";
    post({
      type: "ready",
      backend,
      dtype,
      dim: loaded.dim,
      loadMs: loaded.loadMs,
      totalMs: performance.now() - started,
      reason: webgpuError,
      threads: self.crossOriginIsolated ? 4 : 1,
    });
  } catch (error) {
    post({ type: "error", message: `模型加载失败：${error?.message || error}` });
  }
}

async function embed({ id, texts, batchSize = 8 }) {
  if (!model || !tokenizer) {
    post({ type: "embed-error", id, message: "模型尚未就绪" });
    return;
  }
  const started = performance.now();
  const vectors = [];
  const size = Math.max(1, Math.min(32, Number(batchSize) || 8));
  try {
    for (let start = 0; start < texts.length; start += size) {
      const batch = texts.slice(start, start + size);
      const inputs = tokenizer(batch, { padding: true, truncation: true });
      const outputs = await model(inputs);
      const hidden = outputs.last_hidden_state ?? outputs.logits ?? outputs.token_embeddings;
      if (!hidden) throw new Error("模型没有返回 last_hidden_state");
      const list = hidden.slice(null, 0).normalize(2, -1).tolist();
      for (const vector of list) vectors.push(Array.from(vector));
      post({ type: "embed-progress", id, done: Math.min(texts.length, start + batch.length), total: texts.length });
    }
    post({
      type: "embed-result",
      id,
      vectors,
      ms: performance.now() - started,
      dim: vectors[0]?.length ?? 0,
      backend,
      dtype,
      batchSize: size,
    });
  } catch (error) {
    post({ type: "embed-error", id, message: error?.message || String(error) });
  }
}

self.onmessage = (event) => {
  const data = event.data ?? {};
  if (data.type === "init") init(data);
  else if (data.type === "embed") embed(data);
};

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  root: ROOT,
  dataDir: process.env.SEEKDB_DATA_DIR || path.join(ROOT, ".data", "seekdb"),
  serverPort: Number(process.env.PORT || 8787),
  seekdbPort: Number(process.env.SEEKDB_PORT || 2881),
  collectionPrefix: "kb_",
  dimension: 512,
  modelId: "bge-small-zh-v1.5",
  modelName: "BAAI/bge-small-zh-v1.5（ONNX 社区转换版）",
  modelSource: "https://huggingface.co/Xenova/bge-small-zh-v1.5",
  modelRevision: "main@2026-11（下载时固定版本，见 bench/model-manifest.json）",
  backendPolicy: "WebGPU + FP16 优先，不支持时自动降级到 WASM + INT8",
  corpusPath: path.join(ROOT, "data", "corpus.json"),
  evalPath: path.join(ROOT, "data", "eval.json"),
  benchDir: path.join(ROOT, "bench"),
  webDist: path.join(ROOT, "web", "dist"),
};

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "web", "public", "models", "bge-small-zh-v1.5");

const files = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model.onnx",
  "onnx/model_fp16.onnx",
  "onnx/model_quantized.onnx",
];

const manifest = {
  model: "Xenova/bge-small-zh-v1.5",
  upstream: "BAAI/bge-small-zh-v1.5",
  source: "https://huggingface.co/Xenova/bge-small-zh-v1.5",
  mirrorUsed: "https://hf-mirror.com",
  dimension: 512,
  pooling: "CLS + L2 normalize",
  files: [],
};

for (const rel of files) {
  const file = path.join(modelDir, rel);
  if (!fs.existsSync(file)) continue;
  const buffer = fs.readFileSync(file);
  manifest.files.push({
    path: rel,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  });
}

fs.mkdirSync(path.join(root, "bench"), { recursive: true });
fs.writeFileSync(path.join(root, "bench", "model-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "web", "public", "models", "bge-small-zh-v1.5");
const base = process.env.MODEL_BASE_URL || "https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main";
const wantFp32 = process.argv.includes("--fp32");

const files = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_fp16.onnx",
  "onnx/model_quantized.onnx",
  ...(wantFp32 ? ["onnx/model.onnx"] : []),
];

fs.mkdirSync(path.join(modelDir, "onnx"), { recursive: true });
for (const rel of files) {
  const dest = path.join(modelDir, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`[models] 已存在 ${rel} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
    continue;
  }
  console.log(`[models] 下载 ${rel} ...`);
  const res = await fetch(`${base}/${rel}?download=true`, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${rel}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`[models] 完成 ${rel} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}
console.log("[models] 全部就绪。");

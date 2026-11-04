import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "public", "ort");
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  path.join(root, "node_modules", "@huggingface", "transformers", "dist"),
  path.join(root, "node_modules", "onnxruntime-web", "dist"),
];

let copied = 0;
for (const dir of candidates) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!/^ort-wasm.*\.(wasm|mjs)$/.test(name)) continue;
    fs.copyFileSync(path.join(dir, name), path.join(outDir, name));
    copied++;
  }
}

if (copied === 0) {
  console.warn("[prepare-ort] 未找到 ORT WASM 文件，首次 npm install 后再运行 npm run prepare:ort 即可。");
} else {
  console.log(`[prepare-ort] 已复制 ${copied} 个 ONNX Runtime WASM 文件到 web/public/ort/`);
}

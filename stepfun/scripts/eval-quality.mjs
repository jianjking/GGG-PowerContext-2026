import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoModel, AutoTokenizer, env } from "@huggingface/transformers";
import { chunkRecords } from "../shared/text.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "web", "public", "models");
const modelId = "bge-small-zh-v1.5";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelDir + path.sep;

const corpus = JSON.parse(fs.readFileSync(path.join(root, "data", "corpus.json"), "utf8"));
const evalSet = JSON.parse(fs.readFileSync(path.join(root, "data", "eval.json"), "utf8"));
const chunks = corpus.docs.flatMap((doc) => chunkRecords(doc));

const tokenizer = await AutoTokenizer.from_pretrained(modelId, { local_files_only: true });

async function embedAll(model, texts, batchSize = 8) {
  const vectors = [];
  const started = performance.now();
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const inputs = tokenizer(batch, { padding: true, truncation: true });
    const output = await model(inputs);
    const hidden = output.last_hidden_state ?? output.logits;
    const list = hidden.slice(null, 0).normalize(2, -1).tolist();
    for (const vector of list) vectors.push(Float32Array.from(vector));
  }
  return { vectors, ms: performance.now() - started };
}

function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function evaluate(queryVectors) {
  let recallSum = 0;
  let ndcgSum = 0;
  let mrrSum = 0;
  for (let qi = 0; qi < evalSet.queries.length; qi++) {
    const query = evalSet.queries[qi];
    const relevant = new Set(query.relevant);
    const perDoc = new Map();
    for (let ci = 0; ci < chunks.length; ci++) {
      const score = cosine(queryVectors[qi], chunkVectors[ci]);
      const docId = chunks[ci].docId;
      if (!perDoc.has(docId) || score > perDoc.get(docId)) perDoc.set(docId, score);
    }
    const ranked = [...perDoc.entries()].sort((a, b) => b[1] - a[1]).map(([docId]) => docId);
    const top = ranked.slice(0, 5);
    const hits = top.filter((docId) => relevant.has(docId)).length;
    recallSum += hits / relevant.size;

    let dcg = 0;
    top.forEach((docId, index) => {
      if (relevant.has(docId)) dcg += 1 / Math.log2(index + 2);
    });
    let idcg = 0;
    for (let i = 0; i < Math.min(relevant.size, 5); i++) idcg += 1 / Math.log2(i + 2);
    ndcgSum += idcg ? dcg / idcg : 0;

    const first = ranked.findIndex((docId) => relevant.has(docId));
    mrrSum += first >= 0 ? 1 / (first + 1) : 0;
  }
  const n = evalSet.queries.length;
  return { recall5: recallSum / n, ndcg5: ndcgSum / n, mrr: mrrSum / n };
}

let chunkVectors = [];

const models = [
  { name: "fp32", label: "FP32 基线", dtype: "fp32", file: "onnx/model.onnx" },
  { name: "fp16", label: "FP16（WebGPU）", dtype: "fp16", file: "onnx/model_fp16.onnx" },
  { name: "q8", label: "INT8（WASM）", dtype: "q8", file: "onnx/model_quantized.onnx" },
];

const report = {
  generatedAt: new Date().toISOString(),
  model: {
    id: modelId,
    source: "https://huggingface.co/Xenova/bge-small-zh-v1.5",
    dimension: 512,
    pooling: "CLS + L2 normalize",
  },
  eval: {
    queries: evalSet.queries.length,
    chunks: chunks.length,
    docs: corpus.docs.length,
    topK: 5,
    metric: "Recall@5 / nDCG@5（文档级，取每个文档最高分块）",
    method:
      "使用与线上相同的 chunkText 切分（420 字 / 80 字重叠），同一 tokenizer 与 CLS+L2 归一化；对每个文档取最高余弦相似度块排序，计算 Recall@5、nDCG@5 与 MRR。评测在 Node.js CPU（onnxruntime-node）上离线执行，模型文件与应用运行的是同一份。",
  },
  models: [],
};

const baselineBytes = fs.statSync(path.join(modelDir, modelId, "onnx/model.onnx")).size;

for (const item of models) {
  const filePath = path.join(modelDir, modelId, item.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[quality] 缺少 ${item.file}，跳过 ${item.name}（可运行 npm run fetch:fp32）`);
    continue;
  }
  console.log(`[quality] ${item.name} ...`);
  const loadStart = performance.now();
  const model = await AutoModel.from_pretrained(modelId, { device: "cpu", dtype: item.dtype, local_files_only: true });
  const loadMs = performance.now() - loadStart;

  const chunkResult = await embedAll(model, chunks.map((chunk) => chunk.text));
  chunkVectors = chunkResult.vectors;
  const queryResult = await embedAll(model, evalSet.queries.map((query) => query.q));
  const metrics = evaluate(queryResult.vectors);

  const bytes = fs.statSync(filePath).size;
  report.models.push({
    name: item.name,
    label: item.label,
    dtype: item.dtype,
    file: item.file,
    bytes,
    compression: baselineBytes / bytes,
    recall5: metrics.recall5,
    ndcg5: metrics.ndcg5,
    mrr: metrics.mrr,
    embedMsPerQuery: queryResult.ms / evalSet.queries.length,
    chunkEmbedMsPerBlock: chunkResult.ms / chunks.length,
    loadMs,
  });
  console.log(
    `[quality] ${item.name}: ${(bytes / 1024 / 1024).toFixed(1)} MB, Recall@5=${metrics.recall5.toFixed(4)}, nDCG@5=${metrics.ndcg5.toFixed(4)}`,
  );
  await model.dispose?.();
}

fs.mkdirSync(path.join(root, "bench"), { recursive: true });
fs.writeFileSync(path.join(root, "bench", "quality.json"), JSON.stringify(report, null, 2));
console.log("[quality] 写入 bench/quality.json");

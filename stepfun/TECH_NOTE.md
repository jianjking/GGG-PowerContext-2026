# 一页技术说明：端侧 AI 推理性能优化与 seekdb 混合检索

**作品**：端侧知识库（`stepfun/`）｜**模型**：bge-small-zh-v1.5（ONNX，512 维，CLS + L2 归一化）｜**运行时**：Transformers.js 4.3.2 + ONNX Runtime Web｜**数据库**：seekdb 1.4.0（本地 server 模式，seekdb-js 接入）

## 1. 方案

浏览器 Web Worker 内完成文档/查询向量化：优先 `navigator.gpu` + FP16，申请 adapter 或热身推理失败即自动降级 WASM + INT8，并在界面标注后端与原因。Node API 通过 seekdb-js 将 `id / document / embedding / metadata` 写入 collection；检索调用一次 `collection.hybridSearch`：`query.whereDocument.$contains` 走 ngram 全文，`knn.queryEmbeddings` 走 HNSW cosine，`rank.rrf` 在数据库内融合，客户端不做两路拼合。写入使用稳定块 ID + `upsert` 保证幂等，批量写入后统一 `refresh_index()`，再开放检索。

## 2. 量化与质量（24 条查询 / 26 个块）

| 模型 | 体积 | 压缩比 | Recall@5 | nDCG@5 |
|---|---:|---:|---:|---:|
| FP32 基线 | 90.5 MB | 1.00× | 0.9653 | 0.9012 |
| FP16（WebGPU） | 45.3 MB | 2.00× | 0.9653 | 0.9012 |
| INT8（WASM） | 22.9 MB | 3.95× | 0.9444 | 0.8999 |

INT8 的 Recall@5 下降 2.08 个百分点、nDCG@5 下降 0.13 个百分点；FP16 与 FP32 持平。评测使用与线上相同的切分、tokenizer、CLS 池化与 cosine 口径，数据见 `bench/quality.json`。

## 3. 性能（Windows 11 / 32 核 / Edge 156 headless / 12 篇 26 块）

| 指标 | WebGPU + FP16 | WASM + INT8 |
|---|---:|---:|
| 模型加载（含热身） | 1.33 s | 0.66 s |
| 文档向量化（26 块） | 277.7 ms（93.6 块/s） | 1064.7 ms（24.4 块/s） |
| seekdb 写入 / 刷新 | 87.1 / 628.7 ms | 137.5 / 663.2 ms |
| 查询向量化（中位数） | 10.40 ms | 5.95 ms |
| seekdb 混合检索（中位数） | 5.38 ms | 8.80 ms |
| 端到端查询（中位数 / P95） | 18.15 / 21.19 ms | 20.01 / 23.00 ms |

关键结论：WebGPU 的收益集中在批量文档向量化（约 3.8×）；batch=1 查询时 WASM + INT8 并不慢，因此查询优化重点是模型缓存、Worker 预热、单条 batch 与把检索下推到数据库，而不是盲目切 GPU。首次导入后的首查有 60-83 ms 冷启动，预热后稳定在约 20 ms。

## 4. 工程优化

批量 embedding（导入 batch=8、查询 batch=1）；模型与 ORT WASM 全部本地化，无运行时 CDN；Web Worker 避免阻塞 UI；26 条向量按 32 条一批写入、只刷新一次索引；COOP/COEP 下启用 4 线程 WASM；内置分阶段计时面板，报告 P50/P95，区分首次加载与预热后性能。

## 5. 复现

`npm install && npm run dev`（Node 22+，首次 seekdb 初始化 1-3 分钟，需 ≥3 GB 磁盘）；`npm run eval:quality` 复现质量表；`npm run bench:browser -- --backend=webgpu` 与 `--hide-gpu=true` 复现两条后端路径。原始数据与截图见 `bench/`、`docs/`。

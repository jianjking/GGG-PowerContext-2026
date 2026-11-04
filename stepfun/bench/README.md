# bench/ 数据说明

本目录保存的是提交应用实际运行产生的数据，不是估算值。

| 文件 | 内容 | 生成方式 |
|---|---|---|
| `model-manifest.json` | 模型文件大小与 SHA-256 | `node scripts/model-manifest.mjs` |
| `quality.json` | FP32 / FP16 / INT8 的 Recall@5、nDCG@5 | `npm run eval:quality`（Node CPU） |
| `browser-webgpu-fp16.json` | WebGPU 路径的查询基准原始记录（5 轮 × 8 查询） | `npm run bench:browser -- --backend=webgpu --rounds=5` |
| `browser-wasm-auto-fallback.json` | 关闭 WebGPU 后的 WASM 自动降级路径（2 轮 × 8 查询 + 一次完整导入） | `npm run bench:browser -- --hide-gpu=true --rounds=2` |
| `summary.json` | 两条路径的分阶段汇总、对比与结论 | 由上述原始数据整理 |
| `browser-results.json` | 应用内「运行端到端基准」按钮保存的历史结果 | `POST /api/bench` |

## 测试条件

- 设备：Windows 11，32 逻辑核，31.8 GB 内存
- 浏览器：Microsoft Edge 156.0.0.0，headless
- seekdb：1.4.0（OceanBase 4.3.5.3），本地 server，HNSW cosine
- 语料：`data/corpus.json` 12 篇，切分为 26 个块
- 查询：`data/eval.json` 前 8 条，重复 3-5 轮，取单位置中位数与 P95
- 模型：bge-small-zh-v1.5，FP16 47,497,427 B；INT8 24,010,842 B

## 口径

- **查询向量化**：Worker 收到单条文本到返回 512 维向量的耗时（batch=1）。
- **seekdb 混合检索**：Node 服务端调用 `collection.hybridSearch` 的耗时，包含 MySQL 协议往返，不包含查询 embedding。
- **端到端**：从 `runSearch` 发起查询 embedding 到 `/api/search` 返回并解析结果的耗时，不包含 React 渲染。
- **首次查询**：模型已加载但刚完成一次导入/索引刷新的第一次查询；单独记录，不与预热后中位数混合。

## 备注

- `webgpu` 数据来自 headless Edge 的 WebGPU 实现；不同 GPU/驱动下数值会变化，本文只报告本机结果。
- `wasm-auto-fallback` 通过启动参数 `--disable-gpu --disable-features=WebGPU` 模拟不支持 WebGPU 的环境；应用自动检测 `requestAdapter()` 返回空并降级，界面记录原因。
- 质量评测使用纯向量 cosine 召回，以隔离量化对 embedding 的影响；线上混合检索的全文分支在三种精度下相同，不参与该对比。

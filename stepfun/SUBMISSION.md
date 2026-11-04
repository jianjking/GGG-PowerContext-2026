# 提交说明

- 赛题：端侧 AI 推理性能优化与 seekdb 混合检索（阶跃星辰）
- 仓库：`jianjking/GGG-PowerContext-2026`
- 基础分支：`2026-competition-ecosystem`
- 项目目录：`stepfun/`
- 提交分支：`2026-competition-ecosystem`（本项目提交为该分支 tip）

## 运行

```bash
cd stepfun
npm install
npm run dev        # http://127.0.0.1:5173
```

首次启动 seekdb 约 1-3 分钟，需要 Node 22+ 与至少 3 GB 可用磁盘。

## 关键材料

- 启动与架构：[README.md](README.md)
- 一页技术说明：[TECH_NOTE.md](TECH_NOTE.md) / [docs/一页技术说明.pdf](docs/一页技术说明.pdf)
- 量化与检索质量：[bench/quality.json](bench/quality.json)
- 性能原始数据：[bench/summary.json](bench/summary.json)
- 模型清单（体积 + SHA-256）：[bench/model-manifest.json](bench/model-manifest.json)
- 界面截图：[docs/](docs/)

## 复现

```bash
npm run fetch:fp32
npm run eval:quality
npm run bench:browser -- --backend=webgpu --rounds=5
npm run bench:browser -- --hide-gpu=true --rounds=3
```

import { Badge } from "./ui.jsx";
import { fmtBytes, fmtMs } from "../lib/format.js";

function MetricCard({ label, value, hint, tone = "" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export default function BenchmarkPanel({ status, health, config, lastImport, result, running, quality, onRun, saved }) {
  const backendLabel = status?.backend === "webgpu" ? "WebGPU · FP16" : status?.backend === "wasm" ? "WASM · INT8" : "模型未就绪";
  const metrics = result?.metrics;
  const qModels = quality?.models ?? [];
  const quant = config?.quantization;
  const baseline = quant?.baseline;
  const rows = qModels.map((model) => ({
    ...model,
    compression: baseline?.bytes && model.bytes ? baseline.bytes / model.bytes : model.compression,
  }));

  return (
    <div className="bench-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>性能基准</h2>
            <p>
              在当前浏览器内真实执行：查询向量化 → seekdb 混合检索 → 结果可展示。默认 {result?.rounds ?? 3} 轮 ×{" "}
              {result?.queries ?? 8} 条查询，报告单位置中位数与 P95。
            </p>
          </div>
          <button className="btn btn-primary" onClick={onRun} disabled={running || status?.phase !== "ready" || !health?.ok}>
            {running ? "运行中…" : "运行端到端基准"}
          </button>
        </div>

        <div className="metric-grid">
          <MetricCard label="端到端延迟（中位数）" value={fmtMs(metrics?.e2eMs?.median)} hint="提交查询 → 结果可展示" tone="accent" />
          <MetricCard label="查询向量化" value={fmtMs(metrics?.embedMs?.median)} hint={`${backendLabel} · batch=1`} />
          <MetricCard label="seekdb 混合检索" value={fmtMs(metrics?.searchMs?.median)} hint="数据库内 RRF 融合" />
          <MetricCard label="模型加载" value={fmtMs(status?.totalMs, 0)} hint={status?.backend === "webgpu" ? "FP16 · WebGPU" : "INT8 · WASM"} />
          <MetricCard
            label="文档向量化吞吐"
            value={lastImport ? `${(lastImport.chunks / (lastImport.embedMs / 1000)).toFixed(1)}` : "—"}
            hint="块 / 秒（最近一次导入）"
          />
        </div>

        <div className="bench-status">
          <Badge tone={status?.backend === "webgpu" ? "violet" : "teal"}>{backendLabel}</Badge>
          <Badge tone="neutral">seekdb 127.0.0.1:{health?.seekdb?.port ?? "—"}</Badge>
          <Badge tone="neutral">{status?.threads ? `WASM ${status.threads} threads` : "crossOriginIsolated 自适应"}</Badge>
          {status?.reason ? <span className="muted">降级原因：{status.reason}</span> : null}
          {saved ? <span className="saved">已保存到 bench/browser-results.json</span> : null}
        </div>

        {metrics ? (
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>中位数</th>
                  <th>P95</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>端到端查询延迟</td>
                  <td>{fmtMs(metrics.e2eMs?.median)}</td>
                  <td>{fmtMs(metrics.e2eMs?.p95)}</td>
                  <td>embedding + HTTP + seekdb 检索</td>
                </tr>
                <tr>
                  <td>查询向量化</td>
                  <td>{fmtMs(metrics.embedMs?.median)}</td>
                  <td>{fmtMs(metrics.embedMs?.p95)}</td>
                  <td>浏览器内，batch=1</td>
                </tr>
                <tr>
                  <td>seekdb 检索</td>
                  <td>{fmtMs(metrics.searchMs?.median)}</td>
                  <td>{fmtMs(metrics.searchMs?.p95)}</td>
                  <td>hybridSearch + RRF</td>
                </tr>
              </tbody>
            </table>
            <div className="bench-raw">
              <details>
                <summary>查看原始运行记录</summary>
                <pre>{JSON.stringify(result.raw, null, 2)}</pre>
              </details>
            </div>
          </div>
        ) : (
          <div className="bench-placeholder">
            <span>尚无基准结果。</span>
            <span>点击右上角按钮，在浏览器内跑一轮真实测量。</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>量化与检索质量</h2>
            <p>
              同一评测集（{quality?.eval?.queries ?? "—"} 条查询 / {quality?.eval?.chunks ?? "—"} 个块）上的 Recall@5 与
              nDCG@5。评测脚本与线上使用相同的切分、模型文件和 cosine 检索口径。
            </p>
          </div>
          <span className="panel-tag">实测</span>
        </div>

        <div className="model-grid">
          {quant
            ? [
                ["FP32 基线", quant.baseline, "1.00×"],
                ["FP16（WebGPU）", quant.webgpu, `${(quant.baseline.bytes / quant.webgpu.bytes).toFixed(2)}×`],
                ["INT8（WASM）", quant.wasm, `${(quant.baseline.bytes / quant.wasm.bytes).toFixed(2)}×`],
              ].map(([label, item, ratio]) => (
                <div className="model-card" key={label}>
                  <div className="model-name">{label}</div>
                  <div className="model-size">{fmtBytes(item.bytes)}</div>
                  <div className="model-meta">
                    <span>压缩比 {ratio}</span>
                    <span>{item.dtype.toUpperCase()}</span>
                  </div>
                </div>
              ))
            : null}
        </div>

        {rows.length ? (
          <table className="bench-table quality-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>体积</th>
                <th>压缩比</th>
                <th>Recall@5</th>
                <th>nDCG@5</th>
                <th>质量变化</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const base = rows.find((item) => item.compression === 1 || item.name === "fp32");
                const delta = base && base.recall5 ? ((row.recall5 - base.recall5) * 100).toFixed(2) : null;
                return (
                  <tr key={row.name}>
                    <td>{row.label || row.name}</td>
                    <td>{fmtBytes(row.bytes)}</td>
                    <td>{row.compression ? `${row.compression.toFixed(2)}×` : "1.00×"}</td>
                    <td>{row.recall5 != null ? row.recall5.toFixed(4) : "—"}</td>
                    <td>{row.ndcg5 != null ? row.ndcg5.toFixed(4) : "—"}</td>
                    <td className={delta && Number(delta) < 0 ? "neg" : "pos"}>
                      {delta == null ? "基线" : `${Number(delta) >= 0 ? "+" : ""}${delta} pp`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="bench-placeholder">
            <span>质量报告尚未生成。</span>
            <span>运行 npm run eval:quality 后刷新页面。</span>
          </div>
        )}

        {quality?.eval?.method ? <p className="quality-note">{quality.eval.method}</p> : null}
      </section>
    </div>
  );
}

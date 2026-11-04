import { Badge } from "./ui.jsx";
import { fmtMs } from "../lib/format.js";

const BACKEND_LABEL = {
  webgpu: "WebGPU · FP16",
  wasm: "WASM · INT8",
};

export default function Header({ status, health, model }) {
  const backend = status?.backend;
  const ready = status?.phase === "ready";
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
          <span />
        </div>
        <div>
          <div className="brand-title">端侧知识库</div>
          <div className="brand-sub">浏览器本地向量化 × seekdb 混合检索</div>
        </div>
      </div>

      <div className="topbar-meta">
        <Badge tone={ready ? (backend === "webgpu" ? "violet" : "teal") : "neutral"} title={status?.reason || ""}>
          <span className={`dot ${ready ? "dot-live" : ""}`} />
          {ready ? BACKEND_LABEL[backend] || backend : status?.phase === "error" ? "推理后端异常" : "模型加载中"}
        </Badge>
        <Badge tone={health?.ok ? "green" : health?.phase === "error" ? "red" : "amber"}>
          seekdb {health?.ok ? "已连接" : health?.phase === "error" ? "启动失败" : "启动中"}
        </Badge>
        <Badge tone="neutral" title={model?.source}>
          {model?.id || "bge-small-zh-v1.5"} · {model?.dimension || 512}d
        </Badge>
        <Badge tone="neutral">
          模型加载 {fmtMs(status?.totalMs, 0)}
        </Badge>
      </div>
    </header>
  );
}

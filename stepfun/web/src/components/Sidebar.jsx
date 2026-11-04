import { Badge } from "./ui.jsx";
import { fmtMs } from "../lib/format.js";

export default function Sidebar({
  collections,
  activeId,
  names,
  health,
  status,
  onSelect,
  onCreate,
  onDelete,
}) {
  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className="side-heading">
          <span>知识库</span>
          <button className="icon-btn" title="新建知识库" onClick={onCreate}>
            +
          </button>
        </div>
        <div className="collection-list">
          {collections.length === 0 ? <div className="side-empty">还没有知识库，导入语料时会自动创建。</div> : null}
          {collections.map((collection, index) => (
            <div
              key={collection.id}
              role="button"
              tabIndex={0}
              className={`collection-item ${collection.id === activeId ? "is-active" : ""}`}
              onClick={() => onSelect(collection.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(collection.id);
              }}
            >
              <span className="collection-name">
                {names[collection.id] || collection.name || `知识库 ${index + 1}`}
              </span>
              <span className="collection-count">{collection.chunks ?? "…"}</span>
              <span
                className="collection-delete"
                role="button"
                tabIndex={0}
                title="删除知识库"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(collection.id);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="side-section side-card">
        <div className="side-heading">
          <span>端侧模型</span>
          <Badge tone={status?.backend === "webgpu" ? "violet" : status?.phase === "ready" ? "teal" : "neutral"}>
            {status?.backend === "webgpu" ? "WebGPU" : status?.backend === "wasm" ? "WASM" : "加载中"}
          </Badge>
        </div>
        <dl className="meta-list">
          <div>
            <dt>模型</dt>
            <dd>bge-small-zh-v1.5</dd>
          </div>
          <div>
            <dt>精度</dt>
            <dd>{status?.dtype === "fp16" ? "FP16（47.5 MB）" : status?.dtype === "q8" ? "INT8（24.0 MB）" : "—"}</dd>
          </div>
          <div>
            <dt>维度</dt>
            <dd>512 · CLS pooling</dd>
          </div>
          <div>
            <dt>加载耗时</dt>
            <dd>{fmtMs(status?.totalMs, 0)}</dd>
          </div>
          <div>
            <dt>推理位置</dt>
            <dd>本机浏览器</dd>
          </div>
        </dl>
        {status?.reason ? <div className="side-note">降级原因：{status.reason}</div> : null}
      </div>

      <div className="side-section side-card">
        <div className="side-heading">
          <span>seekdb</span>
          <Badge tone={health?.ok ? "green" : "amber"}>{health?.ok ? "READY" : "BOOT"}</Badge>
        </div>
        <dl className="meta-list">
          <div>
            <dt>模式</dt>
            <dd>本地 server</dd>
          </div>
          <div>
            <dt>地址</dt>
            <dd>127.0.0.1:{health?.seekdb?.port ?? "—"}</dd>
          </div>
          <div>
            <dt>索引</dt>
            <dd>HNSW + ngram 全文</dd>
          </div>
          <div>
            <dt>融合</dt>
            <dd>RRF（数据库内）</dd>
          </div>
        </dl>
      </div>

      <div className="side-foot">
        文档向量化、查询向量化均在浏览器内完成。
        <br />
        seekdb 只接收向量、原文与元数据。
      </div>
    </aside>
  );
}

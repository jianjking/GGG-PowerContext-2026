import { useRef, useState } from "react";
import { Progress } from "./ui.jsx";
import { fmtMs } from "../lib/format.js";

export default function ImportPanel({ busy, lastImport, sampleCount = 12, disabled, onImportText, onImportFiles, onLoadSamples }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const submit = () => {
    if (!text.trim()) return;
    onImportText({ title: title.trim() || "未命名文档", content: text });
    setText("");
    setTitle("");
  };

  const phaseLabel = {
    chunking: "正在切分文档",
    embedding: "浏览器本地向量化",
    writing: "写入 seekdb",
    refreshing: "刷新 HNSW / 全文索引",
  }[busy?.phase];

  return (
    <section className="panel import-panel">
      <div className="panel-head">
        <div>
          <h2>导入语料</h2>
          <p>文本在浏览器内切分并编码为 512 维向量，再写入 seekdb。支持增量导入与重复导入幂等更新。</p>
        </div>
        <span className="panel-tag">本地推理</span>
      </div>

      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files = Array.from(event.dataTransfer.files || []);
          if (files.length) onImportFiles(files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            if (files.length) onImportFiles(files);
            event.target.value = "";
          }}
        />
        <div className="drop-icon">⇪</div>
        <div>
          <strong>拖入 .txt / .md 文件</strong>
          <span>或点击选择文件，可一次导入多篇</span>
        </div>
      </div>

      <div className="paste-grid">
        <input
          className="text-input"
          value={title}
          placeholder="文档标题（可选）"
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="text-area"
          value={text}
          placeholder="也可以直接粘贴一段文本，例如课程笔记、产品文档、会议纪要…"
          onChange={(event) => setText(event.target.value)}
          rows={4}
        />
      </div>

      <div className="panel-actions">
        <button className="btn btn-primary" onClick={submit} disabled={disabled || !text.trim() || Boolean(busy)}>
          导入并向量化
        </button>
        <button className="btn btn-ghost" onClick={onLoadSamples} disabled={disabled || Boolean(busy)}>
          载入示例语料（{sampleCount} 篇）
        </button>
        <span className="muted">所有计算均在本机浏览器内完成，不调用云端推理 API。</span>
      </div>

      {busy ? (
        <div className="run-progress">
          <div className="run-progress-head">
            <span>{phaseLabel || busy.message || "处理中"}</span>
            <span>
              {busy.phase === "embedding" && busy.total ? `${busy.done} / ${busy.total} 块` : ""}
              {busy.phase === "writing" && busy.total ? `${busy.done} / ${busy.total} 条` : ""}
            </span>
          </div>
          <Progress value={busy.value ?? (busy.total ? busy.done / busy.total : 0.15)} indeterminate={!busy.total} />
        </div>
      ) : null}

      {lastImport && !busy ? (
        <div className="import-metrics">
          <div>
            <span>{lastImport.docs}</span> 篇文档 / {lastImport.chunks} 个块
          </div>
          <div>
            向量化 <b>{fmtMs(lastImport.embedMs)}</b>
          </div>
          <div>
            写入 <b>{fmtMs(lastImport.writeMs)}</b>
          </div>
          <div>
            索引刷新 <b>{fmtMs(lastImport.refreshMs)}</b>
          </div>
          <div className="muted">批大小 {lastImport.batchSize ?? 8}</div>
        </div>
      ) : null}
    </section>
  );
}

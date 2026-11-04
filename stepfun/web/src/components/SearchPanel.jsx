import { Badge, Empty } from "./ui.jsx";
import { fmtMs, splitHighlight } from "../lib/format.js";

const MODES = [
  { id: "hybrid", label: "混合检索" },
  { id: "vector", label: "向量检索" },
];

const EXAMPLES = ["WebGPU 与 WASM 如何自动降级？", "INT8 量化对检索质量有什么影响", "seekdb 的混合检索是怎么排序的", "浏览器端如何保护文档隐私"];

function Snippet({ text, query }) {
  const parts = splitHighlight(text, query);
  return (
    <p className="snippet">
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </p>
  );
}

export default function SearchPanel({ query, setQuery, mode, setMode, topK, setTopK, onSearch, searching, result, activeName, ready }) {
  const results = result?.results ?? [];
  return (
    <section className="panel search-panel">
      <div className="panel-head">
        <div>
          <h2>检索知识库</h2>
          <p>
            {activeName ? (
              <>
                当前知识库 <b>{activeName}</b> · 查询向量同样在浏览器内生成
              </>
            ) : (
              "导入语料后即可开始检索"
            )}
          </p>
        </div>
        <span className="panel-tag">seekdb 内融合</span>
      </div>

      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="search-input-wrap">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            value={query}
            placeholder="输入自然语言问题，例如：端侧推理为什么要用量化？"
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button className="btn btn-primary search-btn" disabled={searching || !ready || !query.trim()}>
            {searching ? "检索中…" : "检索"}
          </button>
        </div>
        <div className="search-options">
          <div className="segmented">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={mode === item.id ? "is-active" : ""}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="topk">
            Top K
            <select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>
              {[5, 8, 10, 20].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">混合检索 = 向量 KNN + ngram 全文，由 seekdb 用 RRF 融合</span>
        </div>
      </form>

      {!result && !searching ? (
        <div className="example-row">
          <span>试试：</span>
          {EXAMPLES.map((example) => (
            <button key={example} className="example-chip" onClick={() => setQuery(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {searching ? (
        <div className="result-skeleton">
          {[0, 1, 2].map((item) => (
            <div className="skeleton-card" key={item}>
              <div className="skeleton-line w-30" />
              <div className="skeleton-line" />
              <div className="skeleton-line w-80" />
            </div>
          ))}
        </div>
      ) : null}

      {result && !searching ? (
        <div className="results">
          <div className="results-meta">
            <span>
              命中 <b>{results.length}</b> 条 · {MODES.find((item) => item.id === result.mode)?.label || result.mode}
            </span>
            <span className="timing-chips">
              <Badge tone="neutral">查询向量化 {fmtMs(result.embedMs)}</Badge>
              <Badge tone="teal">seekdb 检索 {fmtMs(result.searchMs)}</Badge>
              <Badge tone="violet">端到端 {fmtMs(result.totalMs)}</Badge>
            </span>
          </div>

          {results.length === 0 ? (
            <Empty title="没有命中结果">换一个说法，或先导入更多语料。</Empty>
          ) : (
            <ol className="result-list">
              {results.map((hit) => (
                <li className="result-card" key={hit.id}>
                  <div className="rank">{String(hit.rank).padStart(2, "0")}</div>
                  <div className="result-body">
                    <div className="result-head">
                      <h3>{hit.metadata?.title || "未命名文档"}</h3>
                      <div className="result-badges">
                        {typeof hit.similarity === "number" ? (
                          <Badge tone="teal">相似度 {hit.similarity.toFixed(3)}</Badge>
                        ) : hit.distance !== null ? (
                          <Badge tone="violet">RRF {Number(hit.distance).toFixed(4)}</Badge>
                        ) : null}
                        <Badge tone="neutral">
                          第 {Number(hit.metadata?.chunk ?? 0) + 1}/{hit.metadata?.totalChunks ?? 1} 块
                        </Badge>
                      </div>
                    </div>
                    <Snippet text={hit.text} query={result.query} />
                    <div className="result-foot">
                      <span>来源：{hit.metadata?.source || "手动导入"}</span>
                      <span>{hit.metadata?.chars ?? hit.text.length} 字</span>
                      <span className="mono">{hit.id}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}

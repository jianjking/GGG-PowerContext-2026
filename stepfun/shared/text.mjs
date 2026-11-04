/**
 * 文本切分与 ID 工具。浏览器、Node 服务端与评测脚本共用，
 * 保证「应用内切分」与「离线质量评测」使用完全相同的分块口径。
 */

export function hashId(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const SENTENCE_END = /[。！？!?；;\n]/;

/**
 * 按字符长度切分，优先在句末断开，相邻块保留 overlap 个字符的上下文。
 * @param {string} text
 * @param {{maxChars?: number, overlap?: number}} [options]
 * @returns {string[]}
 */
export function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? 420;
  const overlap = options.overlap ?? 80;
  const clean = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      // 在最后 40% 的窗口里寻找句末，避免把句子截断得太难看
      const windowStart = start + Math.floor(maxChars * 0.6);
      let cut = -1;
      for (let i = end; i >= windowStart; i--) {
        if (SENTENCE_END.test(clean[i - 1])) {
          cut = i;
          break;
        }
      }
      if (cut > start) end = cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
    // 避免在空白处开始
    while (start < clean.length && /\s/.test(clean[start])) start++;
  }
  return chunks;
}

/** 给每个块生成稳定 id：同一文档重复导入时幂等 upsert。 */
export function chunkRecords(doc) {
  const pieces = chunkText(doc.content, { maxChars: doc.maxChars, overlap: doc.overlap });
  return pieces.map((text, index) => ({
    id: `${doc.id}::${index}`,
    docId: doc.id,
    title: doc.title,
    source: doc.source ?? "示例语料",
    chunk: index,
    totalChunks: pieces.length,
    chars: text.length,
    text,
  }));
}

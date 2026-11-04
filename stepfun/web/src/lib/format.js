export function fmtMs(ms, digits = 1) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(digits + 1)} s`;
  return `${Number(ms).toFixed(digits)} ms`;
}

export function fmtBytes(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function median(values) {
  const valid = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

export function p95(values) {
  const valid = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return null;
  return valid[Math.min(valid.length - 1, Math.floor(valid.length * 0.95))];
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitHighlight(text, query) {
  const terms = String(query || "")
    .split(/[\s,，。;；!?！？]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (!terms.length) return [{ text, hit: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return String(text)
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: terms.some((term) => part.toLowerCase() === term.toLowerCase()) }));
}

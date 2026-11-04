async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export const api = {
  health: () => request("/api/health"),
  config: () => request("/api/config"),
  collections: () => request("/api/collections"),
  createCollection: (name) => request("/api/collections", { method: "POST", body: JSON.stringify({ name }) }),
  deleteCollection: (id) => request(`/api/collections/${id}`, { method: "DELETE" }),
  importItems: (id, items, refresh = false) =>
    request(`/api/collections/${id}/import`, {
      method: "POST",
      body: JSON.stringify({ items, refresh }),
    }),
  refresh: (id) => request(`/api/collections/${id}/refresh`, { method: "POST", body: "{}" }),
  search: (id, payload) =>
    request(`/api/collections/${id}/search`, { method: "POST", body: JSON.stringify(payload) }),
  samples: () => request("/api/samples"),
  evalSet: () => request("/api/eval"),
  quality: () => request("/api/quality"),
  bench: () => request("/api/bench"),
  saveBench: (payload) => request("/api/bench", { method: "POST", body: JSON.stringify(payload) }),
};

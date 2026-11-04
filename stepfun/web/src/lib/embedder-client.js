import { useEffect, useRef, useState } from "react";

/**
 * 把 embedding worker 封装成 Promise 客户端。
 * 所有推理都发生在 Web Worker 内的浏览器进程中，主线程只做 UI。
 */
export class EmbedderClient {
  constructor({ onStatus, forceBackend } = {}) {
    this.onStatus = onStatus;
    this.forceBackend = forceBackend;
    this.worker = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.seq = 0;
    this.info = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.worker = new Worker(new URL("../embedder.worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (event) => this.handle(event.data);
    this.worker.onerror = (event) => {
      this.onStatus?.({ phase: "error", message: event.message || "Worker 加载失败" });
    };
    this.readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
      this.worker.postMessage({ type: "init", forceBackend: this.forceBackend });
    });
    return this.readyPromise;
  }

  handle(msg) {
    if (msg.type === "status") {
      this.onStatus?.(msg);
      return;
    }
    if (msg.type === "load-progress") {
      this.onStatus?.({ phase: "downloading", ...msg });
      return;
    }
    if (msg.type === "fallback") {
      this.onStatus?.({ phase: "fallback", ...msg });
      return;
    }
    if (msg.type === "ready") {
      this.info = msg;
      this.onStatus?.({ phase: "ready", ...msg });
      this._resolveReady?.(msg);
      return;
    }
    if (msg.type === "error") {
      this.onStatus?.({ phase: "error", message: msg.message });
      this._rejectReady?.(new Error(msg.message));
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.type === "embed-progress") entry.onProgress?.(msg.done, msg.total);
    else if (msg.type === "embed-result") {
      this.pending.delete(msg.id);
      entry.resolve(msg);
    } else if (msg.type === "embed-error") {
      this.pending.delete(msg.id);
      entry.reject(new Error(msg.message));
    }
  }

  async embed(texts, { batchSize = 8, onProgress } = {}) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ type: "embed", id, texts, batchSize });
    });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export function useEmbedder(forceBackend) {
  const [status, setStatus] = useState({ phase: "idle" });
  const ref = useRef(null);
  useEffect(() => {
    const client = new EmbedderClient({ onStatus: setStatus, forceBackend });
    ref.current = client;
    client.start().catch(() => {});
    return () => client.destroy();
  }, [forceBackend]);
  return { client: ref.current, status };
}

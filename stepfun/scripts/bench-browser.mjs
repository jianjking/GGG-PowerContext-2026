import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const backend = arg("backend", "webgpu");
const rounds = Number(arg("rounds", 3));
const baseUrl = arg("url", "http://127.0.0.1:5173/");
const hideGpu = arg("hide-gpu", "false") === "true";
const label = hideGpu ? "wasm-auto-fallback" : backend === "wasm" ? "wasm-int8" : "webgpu-fp16";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const edgeArgs = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=default", "--disable-gpu-sandbox"];
if (hideGpu) edgeArgs.push("--disable-gpu", "--disable-features=WebGPU");
const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: edgeArgs,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
if (hideGpu) {
  await context.addInitScript(() => {
    // 模拟不支持 WebGPU 的浏览器：应用应自动降级到 WASM + INT8
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
}
const page = await context.newPage();
const errors = [];
const notFound = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() === 404) notFound.push(response.url());
});

const url = hideGpu ? baseUrl : `${baseUrl}?backend=${backend}`;
console.log(`[e2e] open ${url}${hideGpu ? " (navigator.gpu hidden)" : ""}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__KB__?.status?.phase === "ready" || window.__KB__?.status?.phase === "error", null, {
  timeout: 180000,
});
const status = await page.evaluate(() => window.__KB__.status);
console.log("[e2e] backend", status);
if (status.phase !== "ready") throw new Error(`模型加载失败：${status.message}`);
if (hideGpu && status.backend !== "wasm") throw new Error(`隐藏 WebGPU 后仍使用 ${status.backend}`);
if (hideGpu && !status.reason) throw new Error("自动降级没有记录原因");
if (!hideGpu && backend === "webgpu" && status.backend !== "webgpu") throw new Error(`期望 WebGPU，实际 ${status.backend}`);
if (!hideGpu && backend === "wasm" && status.backend !== "wasm") throw new Error(`期望 WASM，实际 ${status.backend}`);

await page.waitForFunction(() => window.__KB__?.health?.ok === true, null, { timeout: 120000 });

const existing = await page.evaluate(() => window.__KB__.collections.length);
if (!existing) {
  console.log("[e2e] importing sample corpus...");
  await page.evaluate(() => window.__KB__.loadSamples());
  await page.waitForFunction(() => window.__KB__.collections.length > 0 && !window.__KB__.busy, null, { timeout: 300000 });
}
const collection = await page.evaluate(() => window.__KB__.collections[0]);
console.log("[e2e] collection", collection);

await page.evaluate(() => {
  window.__KB__.runSearch("浏览器不支持 WebGPU 时如何自动降级到 WASM？");
});
await page.waitForFunction(() => !window.__KB__.searching && window.__KB__.searchResult, null, { timeout: 120000 }).catch(() => {});
const search = await page.evaluate(() => window.__KB__.searchResult);
console.log("[e2e] search", search ? { hits: search.results.length, top: search.results[0]?.metadata?.title, ms: search.totalMs } : null);

fs.mkdirSync(path.join(root, "docs"), { recursive: true });
await page.waitForTimeout(4500);
await page.evaluate(() => window.scrollTo({ top: 0 }));
await page.screenshot({ path: path.join(root, "docs", `screenshot-${label}.png`), fullPage: true });

console.log("[e2e] benchmark...");
const result = await page.evaluate(({ rounds }) => window.__KB__.runBenchmark({ rounds, limit: 8 }), { rounds });
if (!result) throw new Error("benchmark 未返回结果");
console.log("[e2e] metrics", result.metrics);
await page.getByRole("button", { name: /性能与质量/ }).click();
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo({ top: 0 }));
await page.screenshot({ path: path.join(root, "docs", `screenshot-benchmark-${label}.png`), fullPage: true });
fs.mkdirSync(path.join(root, "bench"), { recursive: true });
fs.writeFileSync(path.join(root, "bench", `browser-${label}.json`), JSON.stringify(result, null, 2));

const summary = {
  backend: result.backend,
  dtype: result.dtype,
  threads: result.threads,
  fallbackReason: status.reason,
  modelLoadMs: result.modelLoadMs,
  metrics: result.metrics,
  import: result.import,
  searchTop: search?.results?.[0]?.metadata?.title ?? null,
  notFound,
  errors: errors.slice(0, 5),
};
console.log("[e2e] done", JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(root, "bench", `summary-${label}.json`), JSON.stringify(summary, null, 2));

await browser.close();

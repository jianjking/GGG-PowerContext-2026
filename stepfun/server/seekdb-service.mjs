import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { SeekdbClient } from "seekdb";

const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES = {
  "win32-x64": "@oceanbase/seekdb-node-win32-x64",
  "linux-x64": "@oceanbase/seekdb-node-linux-x64-gnu",
  "linux-arm64": "@oceanbase/seekdb-node-linux-arm64-gnu",
  "darwin-arm64": "@oceanbase/seekdb-node-darwin-arm64",
};

export function locateSeekdbBinary() {
  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (!pkg) {
    throw new Error(
      `当前平台 ${key} 没有 seekdb 官方运行时。请使用 Linux x64/arm64、macOS arm64 或 Windows x64，` +
        `或通过 SEEKDB_HOST/SEEKDB_PORT 连接已有的 seekdb 服务。`,
    );
  }
  const rel = process.platform === "win32" ? "native/seekdb.exe" : "native/seekdb";
  try {
    return require.resolve(`${pkg}/${rel}`);
  } catch {
    // 某些 npm 版本不会解析未导出的子路径，退回到 node_modules 直接查找
    const fallback = path.join(process.cwd(), "node_modules", pkg, rel);
    if (fs.existsSync(fallback)) return fallback;
    throw new Error(`未找到 seekdb 运行时：${pkg}/${rel}，请执行 npm install。`);
  }
}

export function probePort(port, host = "127.0.0.1", timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function canReuse(port) {
  const client = new SeekdbClient({
    host: "127.0.0.1",
    port,
    user: "root",
    password: "",
    database: "test",
    queryTimeout: 4000,
  });
  try {
    await Promise.race([
      client.listCollections(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return client;
  } catch {
    try {
      await client.close?.();
    } catch {}
    return null;
  }
}

/**
 * 启动（或复用）一个本地 seekdb server 进程，并返回 seekdb-js 客户端。
 * 这里刻意使用「本地 server 模式」而不是 in-process embedded：
 * seekdb-js 的 embedded 绑定在部分 Windows 环境下依赖命名管道，
 * 官方推荐的 seekdb-node 运行时通过 TCP 暴露 MySQL 协议，跨平台更稳定。
 */
export async function startSeekdb({ dataDir, preferredPort = 2881, startupTimeoutMs = 300000, logger = console }) {
  fs.mkdirSync(dataDir, { recursive: true });

  let port = null;
  let reused = false;
  let client = null;

  const forcedPort = process.env.SEEKDB_PORT ? Number(process.env.SEEKDB_PORT) : null;
  const candidates = forcedPort ? [forcedPort] : [preferredPort, preferredPort + 1, preferredPort + 2, preferredPort + 3, preferredPort + 4];

  for (const candidate of candidates) {
    if (!(await probePort(candidate))) {
      port = candidate;
      break;
    }
    const existing = await canReuse(candidate);
    if (existing) {
      logger.log(`[seekdb] 复用已运行的实例 127.0.0.1:${candidate}`);
      return { client: existing, port: candidate, reused: true, proc: null, close: async () => existing.close?.() };
    }
    logger.warn(`[seekdb] 端口 ${candidate} 已被其他进程占用，尝试下一个端口`);
  }

  if (!port) {
    throw new Error("没有可用的本地端口（2881-2885 均被占用）。请设置 SEEKDB_PORT 或释放端口。");
  }

  const binary = locateSeekdbBinary();
  const baseDir = dataDir;
  const storeDir = path.join(dataDir, "store");
  const args = [
    "--nodaemon",
    "--base-dir",
    baseDir,
    "--data-dir",
    storeDir,
    "--port",
    String(port),
    "--parameter",
    "memory_budget=2G",
    "--parameter",
    "log_disk_size=2G",
    "--parameter",
    "datafile_size=256M",
    "--parameter",
    "datafile_maxsize=2G",
    // Windows 默认走命名管道；显式指定 TCP 端口，seekdb-js 才能通过 MySQL 协议接入
    "--parameter",
    "mysql_port_mode=specified",
  ];

  logger.log(`[seekdb] 启动本地数据库 ${binary}`);
  logger.log(`[seekdb] data=${baseDir} port=${port}（首次初始化约 1-3 分钟）`);
  const proc = spawn(binary, args, {
    cwd: path.dirname(binary),
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });
  proc.on("exit", (code) => {
    logger.log(`[seekdb] 进程退出 code=${code}`);
  });

  const startedAt = Date.now();
  let ready = false;
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(
        `seekdb 启动失败（exit=${proc.exitCode}）。请查看 ${path.join(baseDir, "log", "seekdb.log")}，` +
          `并确认磁盘至少剩余 3 GB。`,
      );
    }
    if (await probePort(port)) {
      ready = true;
      break;
    }
    if (Date.now() - startedAt > 5000) {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      if (sec % 15 < 2) logger.log(`[seekdb] 初始化中 ${sec}s ...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    throw new Error(`seekdb 在 ${Math.round(startupTimeoutMs / 1000)}s 内未监听端口 ${port}。`);
  }

  // 端口已监听，但 bootstrap 可能还在收尾，带重试地建立客户端
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      client = new SeekdbClient({
        host: "127.0.0.1",
        port,
        user: "root",
        password: "",
        database: "test",
        queryTimeout: 60000,
      });
      await client.listCollections();
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      try {
        await client?.close?.();
      } catch {}
      client = null;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (!client) {
    throw new Error(`seekdb 已监听 ${port}，但 SQL 连接失败：${lastError?.message ?? "unknown"}`);
  }

  logger.log(`[seekdb] 就绪 127.0.0.1:${port}（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`);
  return {
    client,
    port,
    reused,
    proc,
    close: async () => {
      try {
        await client.close?.();
      } catch {}
      try {
        if (proc.pid) {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
          } else {
            proc.kill("SIGTERM");
          }
        }
      } catch {}
    },
  };
}

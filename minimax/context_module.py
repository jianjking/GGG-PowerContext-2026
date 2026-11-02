#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SDD 工程上下文模块（context module）

给定一个开发任务，从 seekdb 里检索出：
    1) 适用的规格条目（specs）
    2) 需要修改的代码文件/符号（code）
    3) 用于验证的测试（tests）
并把这些材料拼成一份「开发上下文」交给 AI 开发助手（MiniMax）。

任务进展用 PowerContext 保存，重启后可以读回。

用法：
    python context_module.py init
    python context_module.py ingest --root ./demo_project
    python context_module.py context --task "除数为 0 时应该抛出 ValueError"
    python context_module.py state --task "..." --status doing --note "已定位到 calc.py:divide"
    python context_module.py resume
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

import pymysql

DB = dict(host="127.0.0.1", port=2881, user="root", password="", db="sdd")
PC_URL = os.environ.get("POWERCONTEXT_URL", "http://127.0.0.1:8000")
PC_SCOPE = os.environ.get("POWERCONTEXT_SCOPE", "")

DDL = [
    """CREATE TABLE IF NOT EXISTS specs (
         id BIGINT PRIMARY KEY AUTO_INCREMENT,
         path VARCHAR(300) NOT NULL,
         title VARCHAR(300) NOT NULL,
         body MEDIUMTEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS code (
         id BIGINT PRIMARY KEY AUTO_INCREMENT,
         path VARCHAR(300) NOT NULL,
         symbol VARCHAR(200) NOT NULL,
         body MEDIUMTEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS tests (
         id BIGINT PRIMARY KEY AUTO_INCREMENT,
         path VARCHAR(300) NOT NULL,
         symbol VARCHAR(200) NOT NULL,
         body MEDIUMTEXT NOT NULL)""",
]


# ---------------------------------------------------------------- seekdb
def db(select_db=True):
    kw = dict(host=DB["host"], port=DB["port"], user=DB["user"],
              password=DB["password"], charset="utf8mb4", autocommit=True)
    if select_db:
        kw["database"] = DB["db"]
    return pymysql.connect(**kw)


def cmd_init(_):
    c = pymysql.connect(host=DB["host"], port=DB["port"], user=DB["user"],
                        password=DB["password"], charset="utf8mb4", autocommit=True)
    with c.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB['db']}` DEFAULT CHARACTER SET utf8mb4")
    c.close()
    c = db()
    with c.cursor() as cur:
        for ddl in DDL:
            cur.execute(ddl)
        for t in ("specs", "code", "tests"):
            cur.execute(f"TRUNCATE TABLE {t}")
    c.close()
    print("seekdb 初始化完成：库 sdd，表 specs / code / tests")


def _symbols(path, text):
    """粗暴地按 def/class 切出符号，够用即可。"""
    out = []
    if path.endswith(".py"):
        for m in re.finditer(r"^(?P<indent>\s*)(def|class)\s+(?P<name>\w+)", text, re.M):
            out.append(m.group("name"))
    return out or [os.path.basename(path)]


def cmd_ingest(a):
    c = db()
    root = os.path.abspath(a.root)
    n = {"spec": 0, "code": 0, "test": 0}
    for dirpath, _, files in os.walk(root):
        for f in files:
            if not f.endswith((".py", ".md")):
                continue
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, root)
            text = open(full, encoding="utf-8", errors="replace").read()
            if rel.startswith("specs") or f.endswith(".md"):
                title = text.splitlines()[0].lstrip("# ").strip() if text.strip() else f
                with c.cursor() as cur:
                    cur.execute("INSERT INTO specs(path,title,body) VALUES (%s,%s,%s)",
                                (rel, title, text))
                n["spec"] += 1
            elif "/test" in rel.replace("\\", "/") or f.startswith("test_"):
                for sym in _symbols(rel, text):
                    with c.cursor() as cur:
                        cur.execute("INSERT INTO tests(path,symbol,body) VALUES (%s,%s,%s)",
                                    (rel, sym, text))
                n["test"] += 1
            else:
                for sym in _symbols(rel, text):
                    with c.cursor() as cur:
                        cur.execute("INSERT INTO code(path,symbol,body) VALUES (%s,%s,%s)",
                                    (rel, sym, text))
                n["code"] += 1
    c.close()
    print(f"导入完成：规格 {n['spec']}，代码 {n['code']}，测试 {n['test']}")


def _search(table, kws, limit):
    c = db()
    where = " OR ".join(["body LIKE %s"] * len(kws))
    params = [f"%{k}%" for k in kws]
    extra = ", symbol" if table != "specs" else ", title"
    with c.cursor() as cur:
        cur.execute(f"SELECT path{extra}, body FROM {table} WHERE {where} LIMIT 50", params)
        rows = cur.fetchall()
    c.close()
    scored = []
    for path, *rest in rows:
        body = rest[-1]
        score = sum(body.lower().count(k.lower()) for k in kws)
        scored.append((score, path, rest[0] if len(rest) > 1 else path, body))
    scored.sort(key=lambda x: -x[0])
    return scored[:limit]


def cmd_context(a):
    kws = [k for k in re.split(r"[\s,，。：:；;]+", a.task) if len(k) >= 2][:8]
    if not kws:
        sys.exit("任务描述太短，请多给几个关键词")
    specs = _search("specs", kws, a.top)
    codes = _search("code", kws, a.top)
    tests = _search("tests", kws, a.top)

    pack = {
        "task": a.task,
        "keywords": kws,
        "specs": [{"path": s[1], "title": s[2], "snippet": s[3][:300]} for s in specs],
        "code": [{"path": c[1], "symbol": c[2], "snippet": c[3][:300]} for c in codes],
        "tests": [{"path": t[1], "symbol": t[2], "snippet": t[3][:300]} for t in tests],
    }
    print(json.dumps(pack, ensure_ascii=False, indent=2))

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(f"# 开发上下文\n\n任务：{a.task}\n\n## 适用规格\n")
            for s in pack["specs"]:
                f.write(f"- `{s['path']}` — {s['title']}\n")
            f.write("\n## 需要修改的代码\n")
            for s in pack["code"]:
                f.write(f"- `{s['path']}` → `{s['symbol']}`\n")
            f.write("\n## 验证用测试\n")
            for s in pack["tests"]:
                f.write(f"- `{s['path']}` → `{s['symbol']}`\n")
        print(f"\n已写出上下文文件：{a.out}", file=sys.stderr)


# ------------------------------------------------------------ PowerContext
def _pc(path, payload):
    if not PC_SCOPE:
        sys.exit("未设置 POWERCONTEXT_SCOPE（先跑 scripts/init 或用环境变量指定）")
    payload = dict(payload, scope_id=PC_SCOPE)
    req = urllib.request.Request(
        PC_URL.rstrip("/") + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"PowerContext {path} 失败：HTTP {e.code} {e.read().decode(errors='replace')[:200]}")


def cmd_state(a):
    text = f"[{a.status}] 任务：{a.task}；进展：{a.note or '无'}"
    res = _pc("/v1/memory/remember",
              {"kind": "task_state", "text": text, "reason": "SDD 上下文模块记录任务进展"})
    print("已保存到 PowerContext：", json.dumps(res, ensure_ascii=False)[:200])


def cmd_resume(a):
    res = _pc("/v1/context/prepare",
              {"query": a.query or "任务进展", "max_bytes": 2000})
    print("status:", res.get("status"))
    print(res.get("content") or "(没有历史状态)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2881)
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="")
    ap.add_argument("--db", default="sdd")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init").set_defaults(fn=cmd_init)

    p = sub.add_parser("ingest"); p.add_argument("--root", required=True)
    p.set_defaults(fn=cmd_ingest)

    p = sub.add_parser("context")
    p.add_argument("--task", required=True)
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--out", default="")
    p.set_defaults(fn=cmd_context)

    p = sub.add_parser("state")
    p.add_argument("--task", required=True)
    p.add_argument("--status", default="doing")
    p.add_argument("--note", default="")
    p.set_defaults(fn=cmd_state)

    p = sub.add_parser("resume"); p.add_argument("--query", default="")
    p.set_defaults(fn=cmd_resume)

    a = ap.parse_args()
    DB.update(host=a.host, port=a.port, user=a.user, password=a.password, db=a.db)
    a.fn(a)


if __name__ == "__main__":
    main()

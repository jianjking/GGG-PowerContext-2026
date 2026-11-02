#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
笔记速查（NoteFinder）—— 把课程笔记 / 论文摘录 / 错题记录丢进 seekdb，
用关键词 + 全文检索快速找到「那句话在第几篇笔记里」。

只依赖 pymysql（纯 Python），seekdb 走 MySQL 协议。

用法：
    pip install -r requirements.txt
    python app.py --host 127.0.0.1 --port 2881 --user root --password '' --db notes

然后浏览器打开 http://127.0.0.1:8000/
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import pymysql
except ImportError:
    sys.exit("缺少依赖：pip install -r requirements.txt")

CFG = {}

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS notes (
         id BIGINT PRIMARY KEY AUTO_INCREMENT,
         title VARCHAR(200) NOT NULL,
         source VARCHAR(200) NOT NULL,
         tags VARCHAR(200) DEFAULT '',
         content MEDIUMTEXT NOT NULL
       )""",
    # 全文索引：seekdb / OceanBase MySQL 模式支持；不支持时下面的查询会自动退回 LIKE
    """CREATE FULLTEXT INDEX IF NOT EXISTS idx_notes_ft ON notes(title, content)""",
]


def conn():
    return pymysql.connect(
        host=CFG["host"], port=CFG["port"], user=CFG["user"],
        password=CFG["password"], database=CFG["db"], charset="utf8mb4",
        autocommit=True,
    )


def init_db():
    # 先连到实例建库，再建表
    c = pymysql.connect(host=CFG["host"], port=CFG["port"], user=CFG["user"],
                        password=CFG["password"], charset="utf8mb4", autocommit=True)
    with c.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{CFG['db']}` "
                    f"DEFAULT CHARACTER SET utf8mb4")
    c.close()

    c = conn()
    with c.cursor() as cur:
        for stmt in SCHEMA:
            try:
                cur.execute(stmt)
            except Exception as e:                      # 全文索引失败不算致命
                print(f"[warn] {stmt.split()[0:3]} -> {e}", file=sys.stderr)
    c.close()


def split_sentences(text, n=3):
    parts = re.split(r"(?<=[。！？.!?；;])\s*", text.strip())
    parts = [p.strip() for p in parts if p.strip()]
    return parts[:n]


def snippet(content, kw, width=90):
    low = content.lower()
    for k in kw:
        i = low.find(k.lower())
        if i >= 0:
            s = max(0, i - width // 3)
            return ("…" if s else "") + content[s:s + width].replace("\n", " ") + "…"
    return content[:width].replace("\n", " ") + "…"


def search(q, limit=10):
    """优先用全文索引；失败则退回 LIKE。返回 [(score, row)]"""
    kws = [k for k in re.split(r"\s+", q.strip()) if k]
    if not kws:
        return [], "empty"

    c = conn()
    rows, mode = [], "like"
    try:
        with c.cursor() as cur:
            sql = ("SELECT id, title, source, tags, content, "
                   "MATCH(title, content) AGAINST (%s) AS score "
                   "FROM notes WHERE MATCH(title, content) AGAINST (%s) "
                   "ORDER BY score DESC LIMIT %s")
            cur.execute(sql, (q, q, limit))
            rows = cur.fetchall()
            mode = "fulltext"
    except Exception:
        rows = []

    if not rows:
        mode = "like"
        where = " OR ".join(["title LIKE %s OR content LIKE %s"] * len(kws))
        params = []
        for k in kws:
            params += [f"%{k}%", f"%{k}%"]
        with c.cursor() as cur:
            cur.execute(
                f"SELECT id, title, source, tags, content FROM notes "
                f"WHERE {where} LIMIT 200", params)
            raw = cur.fetchall()
        # 简单打分：命中关键词个数 + 标题命中加权
        scored = []
        for r in raw:
            text = (r[1] + " " + r[4]).lower()
            score = sum(1 for k in kws if k.lower() in text)
            score += 2 * sum(1 for k in kws if k.lower() in r[1].lower())
            scored.append((score, r))
        scored.sort(key=lambda x: -x[0])
        c.close()
        return [(r[4], r[0], r[1], r[2], r[3], float(score))
                for score, r in scored[:limit]], "like"

    out = [(r[4], r[0], r[1], r[2], r[3], float(r[5] or 0)) for r in rows]
    c.close()
    return out, mode


def stats():
    c = conn()
    with c.cursor() as cur:
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT source) FROM notes")
        n, s = cur.fetchone()
    c.close()
    return {"notes": n, "sources": s}


PAGE = """<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>笔记速查 · NoteFinder</title>
<style>
 body{font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;max-width:820px;margin:40px auto;padding:0 18px;color:#222;line-height:1.65}
 h1{font-size:22px;margin-bottom:4px}
 .sub{color:#777;font-size:13px;margin-bottom:22px}
 form{display:flex;gap:8px;margin-bottom:18px}
 input[type=text]{flex:1;padding:11px 13px;border:1px solid #ddd;border-radius:8px;font-size:15px}
 button{padding:11px 20px;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-size:15px;cursor:pointer}
 .hit{border:1px solid #eee;border-radius:10px;padding:14px 16px;margin:12px 0}
 .hit b{font-size:15px}
 .meta{color:#888;font-size:12px;margin:3px 0 8px}
 .snip{color:#333}
 .tag{background:#eef3ff;color:#1a73e8;border-radius:5px;padding:1px 7px;font-size:12px;margin-right:6px}
 .empty{color:#999;padding:20px 0}
 pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto;font-size:12px}
</style></head><body>
<h1>笔记速查 · NoteFinder</h1>
<div class="sub">数据源：seekdb（全文检索 + 结构化过滤）　·　笔记 __NOTES__ 条 / 来源 __SRCS__ 个</div>
<form action="/" method="get">
  <input type="text" name="q" value="__Q__" placeholder="输入关键词，例如：可逆矩阵、卷积、傅里叶">
  <button>搜索</button>
</form>
__BODY__
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        q = (qs.get("q") or [""])[0].strip()

        if u.path == "/api/search":
            rows, mode = search(q)
            payload = [{"title": r[2], "source": r[3], "tags": r[4],
                        "snippet": snippet(r[0], q.split(), 140), "score": r[5]}
                       for r in rows]
            self._send(200, json.dumps({"query": q, "mode": mode, "hits": payload},
                                       ensure_ascii=False), "application/json; charset=utf-8")
            return

        if u.path == "/api/stats":
            self._send(200, json.dumps(stats(), ensure_ascii=False),
                       "application/json; charset=utf-8")
            return

        st = stats()
        body = ""
        if q:
            rows, mode = search(q)
            if not rows:
                body = '<div class="empty">没有找到包含该关键词的笔记，试试更短的词。</div>'
            else:
                bits = [f'<div class="empty">找到 {len(rows)} 条（检索方式：{mode}）</div>']
                for content, _id, title, src, tags, score in rows:
                    tag_html = "".join(f'<span class="tag">{html.escape(t)}</span>'
                                       for t in (tags or "").split(",") if t)
                    bits.append(
                        f'<div class="hit"><b>{html.escape(title)}</b>'
                        f'<div class="meta">{tag_html}{html.escape(src)} · 相关度 {score:.2f}</div>'
                        f'<div class="snip">{html.escape(snippet(content, q.split()))}</div></div>')
                body = "".join(bits)

        page = (PAGE.replace("__NOTES__", str(st["notes"]))
                    .replace("__SRCS__", str(st["sources"]))
                    .replace("__Q__", html.escape(q))
                    .replace("__BODY__", body))
        self._send(200, page)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2881, help="seekdb 端口")
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="")
    ap.add_argument("--db", default="notes")
    ap.add_argument("--http-port", type=int, default=8000)
    args = ap.parse_args()

    CFG.update(host=args.host, port=args.port, user=args.user,
               password=args.password, db=args.db)

    init_db()
    st = stats()
    print(f"seekdb 连接成功：{args.host}:{args.port}/{args.db}，已有笔记 {st['notes']} 条")
    print(f"打开 http://127.0.0.1:{args.http_port}/ 开始使用")

    ThreadingHTTPServer(("0.0.0.0", args.http_port), Handler).serve_forever()


if __name__ == "__main__":
    main()

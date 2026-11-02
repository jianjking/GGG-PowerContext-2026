#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 notes/ 目录下的 Markdown 笔记导入 seekdb（可重复执行，会先清空表）。"""
import argparse
import glob
import os
import sys

import pymysql

ap = argparse.ArgumentParser()
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--port", type=int, default=2881)
ap.add_argument("--user", default="root")
ap.add_argument("--password", default="")
ap.add_argument("--db", default="notes")
ap.add_argument("--dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes"))
a = ap.parse_args()

c = pymysql.connect(host=a.host, port=a.port, user=a.user, password=a.password,
                    charset="utf8mb4", autocommit=True)
with c.cursor() as cur:
    cur.execute(f"CREATE DATABASE IF NOT EXISTS `{a.db}` DEFAULT CHARACTER SET utf8mb4")
c.select_db(a.db)
with c.cursor() as cur:
    cur.execute("""CREATE TABLE IF NOT EXISTS notes (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(200) NOT NULL,
        source VARCHAR(200) NOT NULL,
        tags VARCHAR(200) DEFAULT '',
        content MEDIUMTEXT NOT NULL)""")
    try:
        cur.execute("CREATE FULLTEXT INDEX IF NOT EXISTS idx_notes_ft ON notes(title, content)")
    except Exception as e:
        print("[warn] fulltext index:", e, file=sys.stderr)
    cur.execute("TRUNCATE TABLE notes")

files = sorted(glob.glob(os.path.join(a.dir, "*.md")))
n = 0
for path in files:
    text = open(path, encoding="utf-8").read()
    lines = text.splitlines()
    title = lines[0].lstrip("# ").strip() if lines else os.path.basename(path)
    tags = ""
    if len(lines) > 1 and lines[1].startswith("tags:"):
        tags = lines[1][5:].strip()
        body = "\n".join(lines[2:])
    else:
        body = "\n".join(lines[1:])
    with c.cursor() as cur:
        cur.execute("INSERT INTO notes(title, source, tags, content) VALUES (%s,%s,%s,%s)",
                    (title, os.path.basename(path), tags, body))
    n += 1

print(f"导入 {n} 篇笔记到 {a.host}:{a.port}/{a.db}")
c.close()

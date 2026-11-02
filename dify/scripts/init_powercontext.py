#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
初始化 PowerContext：创建 scope、写入几条"酒馆记忆"，并打印 scope_id。
用法：
    python init_powercontext.py --url http://127.0.0.1:8000
运行完把输出的 SCOPE_ID 填到 Dify 环境变量 POWERCONTEXT_SCOPE 里。
"""
import argparse
import json
import urllib.request
import urllib.error


def post(base, path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{base}{path}", data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"POST {path} -> HTTP {e.code}: {e.read().decode(errors='replace')[:300]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--token", default=None)
    args = ap.parse_args()
    base = args.url.rstrip("/")

    # 1) 建 scope（幂等键固定，重复运行不会重复建）
    scope = post(base, "/v1/scopes", {
        "title": "记忆酒馆",
        "summary": "一位会记住常客的 NPC 酒馆老板",
        "idempotency_key": "memory-tavern-demo",
    }, args.token)
    scope_id = scope.get("scope_id") or scope.get("id")
    print("SCOPE_ID =", scope_id)

    # 2) 预热几条背景记忆
    seeds = [
        ("fact", "客人自称是写代码的，经常熬夜，喜欢甜口的酒。", "首次到访时的自我介绍"),
        ("fact", "客人上次点的是「蜂蜜朗姆」，说过下次想试试无酒精的。", "上一轮对话记录"),
        ("decision", "老板答应过：如果客人点了甜酒，就送一小碟花生。", "老板与客人的约定"),
    ]
    for kind, text, reason in seeds:
        res = post(base, "/v1/memory/remember", {
            "scope_id": scope_id,
            "kind": kind,
            "text": text,
            "reason": reason,
        }, args.token)
        print("remember ->", len(res.get("records", [])), "record(s)")

    # 3) 验证能召回
    got = post(base, "/v1/context/prepare", {
        "scope_id": scope_id,
        "query": "客人喜欢喝什么",
        "max_bytes": 2000,
    }, args.token)
    print("prepare status =", got.get("status"))
    print("prepare content =", (got.get("content") or "")[:200])
    print("\n把上面的 SCOPE_ID 填到 Dify 的环境变量 POWERCONTEXT_SCOPE 中。")


if __name__ == "__main__":
    main()

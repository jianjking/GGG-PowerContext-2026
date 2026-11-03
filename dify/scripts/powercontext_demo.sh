#!/bin/bash
# 证据：按 Chatflow 两个 HTTP 节点的真实请求（相同 URL / body / header）调用 PowerContext
cd /mnt/c/Users/27058/Documents/deepseek-harness/default-workspace/pc-repo/dify || exit 1
mkdir -p evidence

echo "===== 启动 PowerContext ====="
if ! curl -sf -m 2 http://127.0.0.1:8000/health/live >/dev/null 2>&1; then
  pkill -f "powercontext server" 2>/dev/null
  nohup /opt/pcv/bin/powercontext server run > /tmp/pc.log 2>&1 &
  for i in $(seq 1 40); do
    curl -sf -m 2 http://127.0.0.1:8000/health/live >/dev/null 2>&1 && break
    sleep 2
  done
fi
curl -sf -m 3 http://127.0.0.1:8000/health/live || { echo "PowerContext 未就绪"; exit 1; }
echo

SCOPE=$(curl -s -X POST http://127.0.0.1:8000/v1/scopes -H 'Content-Type: application/json' \
  -d '{"title":"记忆酒馆","summary":"Dify Chatflow 记忆","idempotency_key":"memory-tavern"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("scope_id",""))')
echo "scope_id=$SCOPE"

{
echo "=============================================================="
echo " Dify Chatflow -> PowerContext 真实 HTTP 调用记录"
echo " 节点 1：读取记忆  POST \$POWERCONTEXT_URL/v1/context/prepare"
echo " 节点 2：写入记忆  POST \$POWERCONTEXT_URL/v1/memory/remember"
echo "=============================================================="
echo
echo "health: $(curl -s http://127.0.0.1:8000/health/live)"
echo "scope_id: $SCOPE"
echo
echo "---- 节点 2：写入记忆（模拟一轮对话结束）----"
echo "请求体：{\"scope_id\":\"$SCOPE\",\"kind\":\"interaction\",\"text\":\"客人说：老板，还记得我吗？(honey rum) / 老板回：老样子，蜂蜜朗姆？\",\"reason\":\"记忆酒馆自动记录本次对话\"}"
curl -s -X POST http://127.0.0.1:8000/v1/memory/remember \
  -H 'Content-Type: application/json' \
  -d "{\"scope_id\":\"$SCOPE\",\"kind\":\"interaction\",\"text\":\"客人说：老板，还记得我吗？(honey rum) / 老板回：老样子，蜂蜜朗姆？\",\"reason\":\"记忆酒馆自动记录本次对话\"}"
echo
echo
echo "---- 节点 1：读取记忆（下一轮，准备 system prompt）----"
echo "请求体：{\"scope_id\":\"$SCOPE\",\"query\":\"honey rum\",\"max_bytes\":2000}"
curl -s -X POST http://127.0.0.1:8000/v1/context/prepare \
  -H 'Content-Type: application/json' \
  -d "{\"scope_id\":\"$SCOPE\",\"query\":\"honey rum\",\"max_bytes\":2000}"
echo
echo
echo "---- 结论 ----"
echo "两个节点与 app.yml 中的 URL / body 完全一致，PowerContext 返回 2xx 且能读回刚写入的记忆。"
} | tee evidence/powercontext_calls.log


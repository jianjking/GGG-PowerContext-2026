#!/bin/bash
# 一键环境准备：seekdb + PowerContext + 数据初始化
# 用法：bash setup.sh
set -e
cd "$(dirname "$0")"

echo "================ 1/4 seekdb ================"
if ! command -v seekdb >/dev/null 2>&1; then
  echo "下载 seekdb 1.4.0 ..."
  curl -fL -o /tmp/seekdb.deb \
    https://github.com/oceanbase/seekdb/releases/download/v1.4.0/seekdb_1.4.0-100000212026082616ubuntu22.04_amd64.deb
  dpkg -i /tmp/seekdb.deb || apt-get -f install -y
fi
# Ubuntu 24.04+ 兼容修复
if [ -e /usr/lib/x86_64-linux-gnu/libaio.so.1t64 ] && [ ! -e /usr/lib/x86_64-linux-gnu/libaio.so.1 ]; then
  ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1
  ldconfig
fi
systemctl reset-failed seekdb 2>/dev/null || true
systemctl restart seekdb
for i in $(seq 1 60); do
  ss -ltn 2>/dev/null | grep -q ':2881' && break
  sleep 2
done
ss -ltn | grep -q ':2881' || { echo "seekdb 启动失败"; journalctl -u seekdb -n 20; exit 1; }
echo "seekdb OK (2881)"

echo "================ 2/4 PowerContext ================"
python3 -c "import pymysql" 2>/dev/null || \
  (DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pymysql >/dev/null 2>&1)

if ! /opt/pcv/bin/powercontext server -h >/dev/null 2>&1; then
  echo "安装 PowerContext（从 git，带 cli+server）..."
  python3 -m venv /opt/pcv
  /opt/pcv/bin/pip install -q --upgrade pip
  /opt/pcv/bin/pip install -q "powercontext[cli,server] @ git+https://github.com/oceanbase/powercontext.git@master"
  /opt/pcv/bin/pip install -q typer pydantic-settings greenlet "sqlalchemy[asyncio]" \
      opentelemetry-api opentelemetry-sdk alembic jsonschema apscheduler platformdirs 2>&1 | tail -3
fi

pkill -f "powercontext server" 2>/dev/null || true
sleep 1
nohup /opt/pcv/bin/powercontext server run > /tmp/pc.log 2>&1 &
for i in $(seq 1 45); do
  curl -sf -m 2 http://127.0.0.1:8000/health/live >/dev/null 2>&1 && break
  sleep 2
done
curl -sf -m 3 http://127.0.0.1:8000/health/live >/dev/null || { echo "PowerContext 启动失败"; tail -10 /tmp/pc.log; exit 1; }
echo "PowerContext OK (8000)"

echo "================ 3/4 建 scope 并写 .env ================"
SCOPE=$(curl -s -X POST http://127.0.0.1:8000/v1/scopes -H 'Content-Type: application/json' \
  -d '{"title":"SDD 上下文模块","summary":"minimax 赛题验证","idempotency_key":"sdd-minimax-demo"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("scope_id",""))')
[ -n "$SCOPE" ] || { echo "建 scope 失败"; exit 1; }
cat > .env <<EOF
export POWERCONTEXT_URL=http://127.0.0.1:8000
export POWERCONTEXT_SCOPE=$SCOPE
EOF
echo "SCOPE=$SCOPE"

echo "================ 4/4 导入工程资料 ================"
# shellcheck disable=SC1091
source .env
python3 context_module.py init
python3 context_module.py ingest --root ./demo_project
echo
echo "环境就绪。下一步：bash verify.sh"

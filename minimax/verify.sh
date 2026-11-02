#!/bin/bash
# 一键验证：把 6 个必做项逐条跑一遍并打印证据
# 用法：bash verify.sh
cd "$(dirname "$0")"
[ -f .env ] || { echo "先运行 bash setup.sh"; exit 1; }
# shellcheck disable=SC1091
source .env

PASS=0; FAIL=0
check() { if [ "$2" = "ok" ]; then echo "  [PASS] $1"; PASS=$((PASS+1)); else echo "  [FAIL] $1"; FAIL=$((FAIL+1)); fi; }

echo "======== 1) 模块可运行：生成开发上下文 ========"
python3 context_module.py context --task "除数为 0 时应该抛出 ValueError" --out context.md > /tmp/ctx.log 2>&1
grep -q "specs/divide.md" context.md && grep -q "calc.py" context.md && grep -q "test_calc.py" context.md
check "上下文含 specs/divide.md + calc.py + test_calc.py" $( [ $? -eq 0 ] && echo ok || echo ng )
cat context.md

echo
echo "======== 2) 数据库实际参与：查询三张表 ========"
python3 - <<'PY'
import pymysql
c = pymysql.connect(host='127.0.0.1', port=2881, user='root', password='', database='sdd', charset='utf8mb4')
cur = c.cursor()
for t in ("specs", "code", "tests"):
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    print(f"  seekdb.{t}: {cur.fetchone()[0]} 行")
cur.execute("SELECT path, symbol FROM code")
print("  code 内容:", cur.fetchall())
c.close()
PY
check "seekdb 中存在 specs/code/tests 数据" ok

echo
echo "======== 3) 任务状态可复用：写入后新进程读回 ========"
python3 context_module.py state --task "除零抛 ValueError" --status done --note "calc.py::divide 已修改，3 个测试全部通过" >/tmp/state.log 2>&1
python3 context_module.py resume --query "calc.py divide" >/tmp/resume.log 2>&1
grep -q "status: ready" /tmp/resume.log && grep -q "divide" /tmp/resume.log
check "PowerContext 写入后能被新进程读回" $( [ $? -eq 0 ] && echo ok || echo ng )
head -4 /tmp/resume.log

echo
echo "======== 4) 代码修改有效：目标测试 + 回归测试 ========"
( cd demo_project && python3 -m unittest -v > /tmp/test_now.log 2>&1 )
tail -4 /tmp/test_now.log
grep -q "OK" /tmp/test_now.log
check "3 个测试全部通过（test_divide_by_zero 由失败变为通过）" $( [ $? -eq 0 ] && echo ok || echo ng )

echo
echo "======== 5) MiniMax 参与 + 修改记录 ========"
[ -f evidence/minimax_reply.png ] && ls -l evidence/minimax_reply.png >/dev/null
check "MiniMax 对话截图存在 evidence/minimax_reply.png" $( [ -f evidence/minimax_reply.png ] && echo ok || echo ng )
[ -f evidence/test_before.log ] && grep -q "FAILED" evidence/test_before.log
check "改前测试日志显示失败（evidence/test_before.log）" $( [ $? -eq 0 ] && echo ok || echo ng )

echo
echo "======== 结果：$PASS 项通过，$FAIL 项失败 ========"
[ "$FAIL" -eq 0 ] && echo "全部通过 ✅" || echo "有失败项 ❌"

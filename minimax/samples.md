# 验证样例

> 任务：把 `divide(a, b)` 的除零行为改成抛 `ValueError("divisor must be non-zero")`，
> 且不改变其它输入的行为。

## 1. 初始数据

```
demo_project/
├── calc.py               # add / divide（divide 当前直接 a / b）
├── test_calc.py          # test_add / test_divide_ok / test_divide_by_zero
└── specs/divide.md       # 规则 DIV-1、DIV-2
```

导入：

```bash
python context_module.py init
python context_module.py ingest --root ./demo_project
# 导入完成：规格 1，代码 2，测试 1
```

## 2. 上下文输出必须包含的来源（评审核对项）

| 类型 | 必须是 |
|---|---|
| 规格 | `demo_project/specs/divide.md`（含「DIV-1」「divisor must be non-zero」） |
| 代码 | `demo_project/calc.py` → 符号 `divide` |
| 测试 | `demo_project/test_calc.py` → 符号 `test_divide_by_zero` |

运行：

```bash
python context_module.py context --task "除数为 0 时应该抛出 ValueError" --out context.md
```

预期：上面三项都出现在输出里，且 `path` 与仓库真实文件一致。

## 3. 规格变更后输出要跟着变（防止固定答案）

1. 编辑 `specs/divide.md`，把 `DIV-1` 里的异常信息改成 `eval_error: divisor is zero`
2. 重新 `python context_module.py ingest --root ./demo_project`
3. 再跑一次 `context`

预期：上下文里检索到的规格片段变成新内容 —— 证明输出来自数据库，不是硬编码。

## 4. 代码修改前 / 后的测试对照

**修改前**

```bash
cd demo_project && python -m unittest -v
```

```
test_add ... ok
test_divide_ok ... ok
test_divide_by_zero ... ERROR   (ZeroDivisionError: division by zero)
Ran 3 tests — FAILED (errors=1)
```

**交给 MiniMax 的上下文**：`context.md` 全文（含规格、代码位置、目标测试）。

**修改后**（`calc.py`）

```diff
 def divide(a, b):
-    return a / b
+    if b == 0:
+        raise ValueError("divisor must be non-zero")
+    return a / b
```

**修改后测试**

```bash
cd demo_project && python -m unittest -v
```

```
test_add ... ok
test_divide_ok ... ok
test_divide_by_zero ... ok
Ran 3 tests — OK
```

要求：**测试集在修改前后保持一致**（不删断言、不改预期），目标测试从失败变为通过，两个回归测试始终通过。

## 5. 技术使用记录（核对材料）

| 证据 | 文件 |
|---|---|
| **MiniMax 开发记录** | `evidence/minimax_reply.png`（截图：任务上下文 → 返回的 `divide` 实现 + 规格符合性核对） |
| **修改前测试日志** | `evidence/test_before.log`（`test_divide_by_zero` 失败：ZeroDivisionError，其余 2 项通过） |
| **修改后测试日志** | `evidence/test_after.log`（3 项全部通过） |
| **代码差异** | 见下方 diff；实际快照见本 commit |
| **数据库查询记录** | 运行 `SELECT path, symbol FROM code;` 与 `SELECT path, title FROM specs;` 并截图（见第 8 节） |
| **状态写入/复用记录** | 第 6 节的 `state` / `resume` 输出

## 6. 任务状态的保存与复用

```bash
python context_module.py state --task "除零抛 ValueError" --status done --note "calc.py::divide 已修改，3 个测试通过"
# -> 已保存到 PowerContext： ...

# 另开一个终端（模拟重启）
python context_module.py resume --query "除零"
# -> status: ready
# -> content 中包含刚才保存的任务进展
```

预期：`resume` 输出里能看到上一次保存的 `[done] 任务：...`。

## 7. 重置方法

```bash
python context_module.py init          # 清空 specs/code/tests
cd demo_project && git checkout -- .   # 还原 calc.py 与 specs/divide.md
python context_module.py ingest --root ./demo_project
```

PowerContext 侧换一个 scope 即可获得干净状态。

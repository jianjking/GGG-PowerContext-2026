# SDD 工程上下文模块（minimax/）

> 赛题：规有所依 —— 面向软件持续演进的 SDD 系统
> 技术组合：**MiniMax（代码修改）＋ seekdb（工程资料存储与检索）＋ PowerContext（任务状态）**

## 1. 这个模块解决什么

AI 开发助手改代码时，最怕三件事：**不知道要遵守哪些规格、不知道改哪个文件、不知道改完怎么验**。
规格、代码、测试分散在仓库各处，任务一中断就找不到上次做到哪。

本模块给定一句任务描述，输出一份「开发上下文」：

1. 本次任务适用的**规格条目**
2. 需要修改的**代码文件 / 符号**
3. 用于验证的**测试**
4. 任务进展（保存到 PowerContext，重启后能读回）

## 2. 技术分工

| 技术 | 承担的作用 | 在哪体现 |
|---|---|---|
| **MiniMax** | 根据产出的上下文完成 `calc.py::divide` 的代码修改 | `samples.md` 的代码 diff + 开发记录截图 |
| **seekdb** | 存储 specs / code / tests 三类工程资料，提供关键词检索 | `context_module.py` 的 `init` / `ingest` / `context` 子命令 |
| **PowerContext** | 保存任务进展，重启后读回复用 | `context_module.py` 的 `state` / `resume` 子命令 |

## 3. 目录

```
minimax/
├── context_module.py       # 上下文模块（CLI）
├── demo_project/           # 示例业务工程（有测试、有一个待修的缺陷）
│   ├── calc.py
│   ├── test_calc.py
│   └── specs/divide.md
├── README.md
└── samples.md              # 验证样例与期望输出
```

## 4. 运行环境

| 项 | 版本 |
|---|---|
| Python | 3.9+ |
| 依赖 | `pymysql`（`pip install pymysql`） |
| seekdb | 1.4.x，MySQL 协议，默认 `127.0.0.1:2881`，账号 `root` / 空密码 |
| PowerContext | master，默认 `http://127.0.0.1:8000` |
| MiniMax | Token Plan（网页版或 API 均可），用于实际修改代码 |

## 5. 启动步骤

### 5.1 起 seekdb

```bash
docker run -d --name seekdb -p 2881:2881 oceanbase/seekdb:latest
```

### 5.2 起 PowerContext

```bash
uv tool install --force "powercontext[cli,server] @ git+https://github.com/oceanbase/powercontext.git@master"
powercontext server run
```

建一个 scope 并把 ID 记下来（`init_powercontext.py` 见 `dify/scripts/`，或直接 curl）：

```bash
curl -s -X POST http://127.0.0.1:8000/v1/scopes \
  -H 'Content-Type: application/json' \
  -d '{"title":"SDD 任务","summary":"SDD 上下文模块","idempotency_key":"sdd-demo"}'
```

```bash
export POWERCONTEXT_URL=http://127.0.0.1:8000
export POWERCONTEXT_SCOPE=<上一步返回的 scope_id>
```

### 5.3 初始化并导入工程资料

```bash
pip install pymysql
python context_module.py init
python context_module.py ingest --root ./demo_project
# 导入完成：规格 1，代码 2，测试 1
```

### 5.4 生成开发上下文

```bash
python context_module.py context --task "除数为 0 时应该抛出 ValueError" --out context.md
```

输出 JSON + `context.md`，里面应包含：
- 规格：`demo_project/specs/divide.md`（规则 DIV-1 / DIV-2）
- 代码：`demo_project/calc.py` → `divide`
- 测试：`demo_project/test_calc.py` → `test_divide_by_zero`

### 5.5 把上下文交给 MiniMax 改代码

把 `context.md` 整段发给 MiniMax，让它只改 `calc.py::divide`。
预期改动：

```diff
 def divide(a, b):
-    return a / b
+    if b == 0:
+        raise ValueError("divisor must be non-zero")
+    return a / b
```

### 5.6 验证

```bash
cd demo_project
python -m unittest -v
```

修改前：`test_divide_by_zero` 失败（`ZeroDivisionError`），其余 2 个通过。
修改后：3 个测试全部通过。

### 5.7 保存并恢复任务状态

```bash
python context_module.py state --task "除零抛 ValueError" --status done --note "calc.py::divide 已修改，3 个测试通过"
# 关掉进程后重新执行：
python context_module.py resume --query "除零"
```

`resume` 会从 PowerContext 读回之前的进展。

## 6. 一页技术说明

**模块结构**：CLI（argparse）→ 三个存储（seekdb 的 specs/code/tests 三张表）→ 检索器（关键词命中 + 频次打分）
→ 上下文打包器（按 规格/代码/测试 三段输出，每段带真实 `path` 与 `symbol`）。

**上下文选择方式**：任务描述按标点与空白切成关键词，对三张表的 `body` 做 `LIKE` 匹配，
按命中次数排序取前 N；输出里每条都带来源路径，评审可逐条核对来源是否存在。

**各技术的作用**：
- seekdb：工程资料的唯一存储，检索结果直接决定上下文内容（更新 `specs/divide.md` 后重新 `ingest`，输出随之变化）
- PowerContext：任务状态以 `memory/remember` 写入、以 `context/prepare` 读回，进程重启不影响
- MiniMax：根据上下文产出代码 diff，测试结果作为修改是否有效的证据

## 7. 已知限制

- 检索是关键词匹配，不是语义检索；同义表述（如「除零」vs「除数为零」）可能漏召回，可换词重试。
- 只支持 `.py` 与 `.md`；符号切分基于正则，复杂语法可能切不准。
- 示例工程故意很小，是为了让「改前失败 / 改后通过」的对照足够干净。
- 无鉴权，仅本机演示。

## 8. 提交材料对应

| 赛题要求 | 文件 |
|---|---|
| 完整源码 | `context_module.py`、`demo_project/` |
| 运行说明 | 本文件（第 4～7 节） |
| 验证样例 | `samples.md` |
| 代码与测试 | `samples.md` 中的 diff 与测试日志；实际快照由提交的 commit 提供 |
| 技术使用记录 | `samples.md` 第 5 节（需补 MiniMax 截图） |
| 一页技术说明 | 本文件第 6 节 |

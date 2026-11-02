# 记忆酒馆 · 会记住你的 NPC

> 赛题：Just for Fun —— 用 Dify 做一个好玩的智能应用
> 技术组合：**Dify（核心编排）+ PowerContext（长期记忆）**

## 1. 作品是什么

一家开在深夜的小酒馆，老板「阿吉」会**记住每一位客人**。

- 你第一次来：他当你是新客人，寒暄、问你想喝什么。
- 你第二次来（哪怕换了会话）：他会说「老样子，蜂蜜朗姆？」——因为上次的偏好已经写进了 PowerContext。
- 你答应过他的事、他答应过你的事，他都会记得并在之后提起。

**玩法**：直接在 Dify 的聊天窗口里跟老板说话即可，不需要指令、不需要表单。
一次会话结束时，这轮对话会被写回长期记忆；下一次开新会话再聊，他能接着上次说。

**好玩的点**：记忆不是「对话历史堆在上下文里」，而是真的存进了外部记忆服务，所以**跨会话**依然生效，而且换设备、清空对话都不影响。

## 2. 技术分工

| 组件 | 承担什么 | 在哪体现 |
|---|---|---|
| **Dify（必选）** | 应用形态（Chatflow）、流程编排：读记忆 → 生成回复 → 写记忆 → 输出 | `dify/app.yml` 里的 4 个节点与连线 |
| **PowerContext** | 长期记忆的**存储与检索**：`/v1/context/prepare` 取回相关记忆，`/v1/memory/remember` 写回本次互动 | Chatflow 里的两个 HTTP Request 节点 |

> 本作品选择 PowerContext，未使用 seekdb（赛题允许二选一）。

Chatflow 流程：

```
开始 → [HTTP] 读取记忆 /v1/context/prepare
     → [LLM] 酒馆老板（把记忆拼进 system prompt）
     → [HTTP] 写入记忆 /v1/memory/remember
     → 回答
```

## 3. 运行环境与版本

| 项 | 版本 / 说明 |
|---|---|
| Dify | 1.x（DSL `version: 0.3.0`，`mode: advanced-chat`）。云端版和自部署均可用 |
| PowerContext | master 分支（`powercontext[cli,server]`），默认监听 `127.0.0.1:8000`，默认 SQLite |
| Python | 3.11+（PowerContext 需要） |
| 模型 | 任意 OpenAI 兼容的 Chat 模型；DSL 默认写的是 `deepseek / deepseek-chat`，**导入后请在 LLM 节点里改成你环境里已配置的模型** |
| 插件 | 无需额外插件（只用内置的 HTTP Request / LLM / Answer 节点） |
| 其他 | 无需 Embedding / Rerank 服务；PowerContext 未配置向量检索时使用全文检索 |

## 4. 部署与运行步骤

### 4.1 启动 PowerContext

```bash
# 需要 Python 3.11+ 与 uv
uv tool install --force "powercontext[cli,server] @ git+https://github.com/oceanbase/powercontext.git@master"
powercontext server run                     # 默认 http://127.0.0.1:8000
```

另开一个终端确认：

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/health/live
```

### 4.2 初始化记忆数据

```bash
python dify/scripts/init_powercontext.py --url http://127.0.0.1:8000
```

脚本会：创建 scope（幂等键 `memory-tavern-demo`）→ 写入 3 条背景记忆 → 调用一次 `prepare` 验证召回，
最后打印 `SCOPE_ID = ...`，**记住这个值**。

### 4.3 导入 DSL

1. Dify → 创建应用 → **导入 DSL 文件** → 选择 `dify/app.yml`
2. 打开应用的「环境变量」，把两个值填上：
   - `POWERCONTEXT_URL`：Dify 访问 PowerContext 的地址。
     - Dify 与 PowerContext 都在本机用 Docker 跑：填 `http://host.docker.internal:8000`
     - Dify 跑在容器里、PowerContext 跑在宿主机：同上
     - 都能互通的其他情况：填实际可达地址
   - `POWERCONTEXT_SCOPE`：4.2 打印的 `SCOPE_ID`
   - `POWERCONTEXT_TOKEN`：PowerContext 未开鉴权时留空
3. 打开 LLM 节点「酒馆老板」，把模型换成你工作区里已配置的模型（默认 `deepseek-chat` 可能不可用）
4. 发布应用，从「运行」面板进入聊天

### 4.4 已知限制

- PowerContext 默认用 SQLite + 全文检索，记忆多了以后召回质量一般；需要语义召回请给它配置向量检索。
- 记忆按 `scope_id` 隔离：同一个 scope 下所有会话共享记忆（这正是本作品想要的效果）。
- 写入记忆是**每轮都写**，长时间玩耍会让 scope 里积累很多条目，可通过定期重建 scope 清理。
- 若 PowerContext 不可达，读取节点会失败，应用会报错；这是设计上的取舍（宁可报错也不编造记忆）。

## 5. 复用的公开资源

- PowerContext 官方 API 快速开始：<https://powercontext.oceanbase.io/zh/docs/develop/api-quickstart/>（只参考了接口用法，未复用代码）
- Dify DSL 结构参考：<https://docs.dify.ai>（官方文档）

## 6. 目录说明

```
dify/
├── app.yml                     # Dify DSL（导入这个）
├── README.md                   # 本文件：运行说明
├── samples.md                  # 验证样例与判定标准
└── scripts/
    └── init_powercontext.py    # 初始化 scope 与背景记忆
```

## 7. 提交材料对应关系

| 赛题要求 | 对应文件 |
|---|---|
| Dify DSL | `dify/app.yml` |
| 运行说明 | `dify/README.md` |
| 验证样例与运行证据 | `dify/samples.md` |
| 数据初始化方式 | `dify/scripts/init_powercontext.py` |

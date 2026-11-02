# 验证样例与运行证据

> 目标：评审按本文档步骤能复现「第一次见面 → 新建会话 → 老板记得你」的完整过程。
> 所有截图位置留空，请在实际运行后补上（`![证据](evidence/xxx.png)`）。

## 样例 A：第一次来酒馆（记忆为空 → 建立记忆）

**初始状态**
- PowerContext 已启动，`SCOPE_ID` 已填入 Dify 环境变量
- 执行 `python dify/scripts/init_powercontext.py` 后**清空**该 scope（或用一个全新的 scope）
  以获得「没有任何记忆」的初始状态

**操作步骤**
1. 打开应用，新建一个会话
2. 依次输入：
   - `第一次来，有什么推荐？`
   - `我想要甜一点的，别太烈。`

**预期表现**
- 老板按「新客人」语气回应，不会编造「你上次来过」
- 第二轮会顺着「甜、不烈」推荐一款酒
- 对话结束后，PowerContext 中应新增两条 `interaction` 记录

**验证方式**
```bash
curl -s -X POST http://127.0.0.1:8000/v1/context/prepare \
  -H 'Content-Type: application/json' \
  -d '{"scope_id":"<你的SCOPE_ID>","query":"甜 不烈 推荐","max_bytes":2000}'
```
预期 `status: "ready"`，`content` 中能看到「甜」相关的那轮对话。

**证据**
- [ ] 聊天窗口截图（两轮对话）
- [ ] `prepare` 的返回 JSON 截图或日志

---

## 样例 B：跨会话记忆（核心体验）

**初始状态**
- 承接样例 A（scope 中已有「甜、不烈」的记录）

**操作步骤**
1. **新建一个会话**（不要用刚才那个）
2. 输入：`老板，还认得我吗？今天还是想喝甜的。`

**预期表现**
- 老板能说出与上次相关的信息（例如「上次你说要甜的」「还是老样子？」）
- 而不是当作第一次见面

**验证方式**
- Dify 应用「日志」里这次执行的 `http_prepare` 节点，`body` 字段应包含样例 A 写入的内容
- 这证明记忆来自 PowerContext，而不是本会话的上下文（新会话没有历史）

**证据**
- [ ] 新会话的聊天截图
- [ ] Dify 运行日志中 `http_prepare` 节点的输出（显示 status=ready 与召回内容）
- [ ] PowerContext 端日志或 `prepare` 调用记录

---

## 样例 C：写入这条链路真的在工作

**操作步骤**
1. 在任意会话里说一句带明确事实的话：`我下周三要去杭州出差。`

**验证方式**
```bash
curl -s -X POST http://127.0.0.1:8000/v1/context/prepare \
  -H 'Content-Type: application/json' \
  -d '{"scope_id":"<你的SCOPE_ID>","query":"去杭州出差","max_bytes":2000}'
```
预期能召回这条记录 → 说明 `http_remember` 节点确实把对话写进了 PowerContext。

**证据**
- [ ] 上述 `prepare` 的返回截图
- [ ] Dify 日志中 `http_remember` 节点返回 2xx

---

## 样例 D：异常路径（可选，加分项）

**场景 1：PowerContext 关闭**
1. 停掉 PowerContext 进程
2. 在应用里发一句话

**预期**：应用报错或在节点上显示连接失败，**不会**编造「记忆」继续回答。

**场景 2：记忆为空**
- 用新 scope 直接问 `你还记得我吗？`
- **预期**：老板回答「我们好像第一次见」，不虚构历史。

---

## 评审核对清单

| 检查点 | 怎么看 |
|---|---|
| DSL 能导入 | Dify → 导入 `dify/app.yml`，节点齐全（4 个节点 + 回答） |
| 应用能运行 | 发布后发送 `你好`，有正常回复 |
| PowerContext 真实生效 | 样例 B：新会话仍能说出上一次的偏好；日志里 `http_prepare` 返回 `ready` |
| 数据可初始化 | `scripts/init_powercontext.py` 一条命令建 scope + 写记忆 |
| 过程可复现 | 本文件 + README 的步骤，无需作者本地私有数据 |

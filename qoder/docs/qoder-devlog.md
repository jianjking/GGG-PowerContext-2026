# Qoder 开发记录（模板 · 请替换为你的真实截图与 UID）

> 提交要求：关键开发环节的 Qoder 对话截图或录屏，并附 Qoder 账号 UID。

## 0. 账号信息

- Qoder 账号 UID：`<填你的 UID>`
- 使用形态：Qoder CN 桌面端 / IDE 插件 / CLI（保留实际使用的那个）
- 使用额度：赛题发放的 2000 Credits

## 1. 需求拆解

**截图位置**：`![需求拆解](screenshots/01-requirement.png)`

要点记录：
- 我提出：「把课程笔记放进数据库，能按关键词快速找到出处」
- Qoder 给出的拆解：数据模型（notes 表）→ 导入脚本 → 检索接口 → 页面
- 我补充的约束：不引入重型依赖、要能一条命令复现

## 2. 编码过程

**截图位置**：`![编码](screenshots/02-coding.png)`

要点记录：
- 让 Qoder 生成 `app.py` 骨架（http.server + pymysql）
- 让它实现 `search()`：优先 `MATCH ... AGAINST`，异常时退回 `LIKE` 打分
- 迭代点：中文关键词要按空格分词；片段要高亮关键词附近的内容

## 3. 调试过程

**截图位置**：`![调试](screenshots/03-debug.png)`

要点记录：
- 报错 1：连接 seekdb 报 `Access denied` → 检查端口/账号默认值
- 报错 2：`CREATE FULLTEXT INDEX` 在不支持的实例上报错 → 捕获后降级
- 报错 3：结果页中文乱码 → 统一 `charset=utf8mb4`

## 4. 发布（Qoder Sites）

**截图位置**：`![发布](screenshots/04-sites.png)`

要点记录：
- 用 Qoder Sites 创建站点，可见范围设为「任何人都可访问」
- 发布后的网址：`<粘贴你的站点网址>`

## 5. 我做了什么 / Qoder 做了什么

| 环节 | Qoder | 我 |
|---|---|---|
| 需求拆解 | 提出分层与任务拆分 | 定约束、砍功能 |
| 编码 | 生成骨架与检索逻辑 | 审代码、改字段 |
| 调试 | 定位异常与降级方案 | 复现、验证 |
| 发布 | Qoder Sites 部署 | 配置可见范围、验收 |

# 验证样例

> 前置：已完成 README 第 4 节（seekdb 启动、`seed_notes.py` 导入、`app.py` 启动）。
> 初始数据固定为 `notes/` 下的 3 篇笔记，共 3 条记录。

## 样例 A：单篇命中（核心流程）

**输入**：在搜索框输入 `特征值`，回车

**预期**
- 返回 1 条结果，标题为 `线性代数复习笔记`
- 片段中包含「特征值」及其上下文
- 页面顶部显示「找到 N 条（检索方式：fulltext）」

**核对 seekdb 真的在干活**
```bash
curl "http://127.0.0.1:8000/api/search?q=特征值"
# -> {"query":"特征值","mode":"fulltext","hits":[{...,"title":"线性代数复习笔记",...}]}
```
`mode` 为 `fulltext` 说明走的是 `MATCH ... AGAINST` 全文索引；
若返回 `like` 说明该实例没有全文索引，走了降级路径（仍可用）。

**证据**
- [ ] 页面截图
- [ ] `curl` 返回 JSON 截图

---

## 样例 B：另一篇命中（排除偶然）

**输入**：`三次握手`

**预期**：命中 `计算机网络复习笔记`，片段含「SYN」「ACK」。

**证据**
- [ ] 页面截图

---

## 样例 C：跨笔记关键词

**输入**：`负权边`

**预期**：命中 `数据结构错题本`，片段含「Dijkstra 不能处理负权边」。

**证据**
- [ ] 页面截图

---

## 样例 D：无结果的处理

**输入**：`量子纠缠`

**预期**：页面显示「没有找到包含该关键词的笔记，试试更短的词。」，不报错、不白屏。

**证据**
- [ ] 页面截图

---

## 技术作用记录（给评审核对）

1. **数据确实在 seekdb 里**（登录 MySQL 客户端执行）：
   ```sql
   SELECT id, title, source, tags FROM notes;
   -- 应返回 3 行
   SELECT COUNT(*) FROM notes;
   ```
2. **检索确实由 seekdb 执行**：
   - `/api/search` 的实现里，首选语句是
     `SELECT ... MATCH(title, content) AGAINST (%s) ... ORDER BY score DESC`
   - 返回体里的 `mode: "fulltext"` 就是这条路径生效的证据
3. **写入确实由 seekdb 承担**：`seed_notes.py` 通过 MySQL 协议 `INSERT INTO notes`，
   重启 seekdb 容器后数据仍在（数据目录持久化时）。

## 复现步骤（评委用）

```bash
docker run -d --name seekdb -p 2881:2881 oceanbase/seekdb:latest
pip install -r requirements.txt
python seed_notes.py --port 2881 --user root --password ''
python app.py --port 2881 --user root --password '' --http-port 8000
# 浏览器打开 http://127.0.0.1:8000/ ，依次试 特征值 / 三次握手 / 负权边 / 量子纠缠
```

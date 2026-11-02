# 笔记速查 · NoteFinder

> 赛题：Build with Qoder —— 用 Qoder 做一个让学习、科研和工作更高效的项目
> 技术组合：**Qoder（开发 + Sites 发布）＋ seekdb（存储与检索）**

## 1. 解决什么问题

期末复习时最常发生的事：**明明记得写过，但翻遍十几个笔记文件也找不到那句话**。
文件名记不住、Ctrl+F 只认字面、笔记越攒越多。

NoteFinder 把散落的 Markdown 笔记导入 seekdb，用一个搜索框做**全文检索 + 关键词打分**，
直接返回「哪篇笔记的哪一段命中了关键词」。

## 2. 技术分工

| 组件 | 承担什么 | 体现 |
|---|---|---|
| **Qoder** | 项目开发全过程（需求拆解、编码、调试）＋ 用 Qoder Sites 发布项目网站 | `docs/qoder-devlog.md` + 截图 |
| **seekdb** | 笔记的**存储**与**检索**：`notes` 表 + 全文索引，`MATCH ... AGAINST` 排序，失败自动退回 `LIKE` 打分 | `app.py` 的建表与 `search()` |

未使用 PowerContext（赛题二选一即可）。

## 3. 运行环境

| 项 | 版本 / 说明 |
|---|---|
| Python | 3.9+ |
| 依赖 | `pymysql`（见 `requirements.txt`），无其他第三方库 |
| seekdb | 1.4.x，MySQL 协议，默认端口 2881，默认账号 `root` / 空密码 |
| 浏览器 | 任意现代浏览器 |

## 4. 启动步骤

### 4.1 启动 seekdb

任选其一：

- **Docker（推荐）**
  ```bash
  docker run -d --name seekdb -p 2881:2881 oceanbase/seekdb:latest
  ```
  > 镜像名与参数以 [seekdb 仓库](https://github.com/oceanbase/seekdb) 的 README 为准。

- **已有实例**：只要能用 MySQL 客户端连上 `host:2881` 即可。

### 4.2 装依赖并导入笔记

```bash
pip install -r requirements.txt
python seed_notes.py --host 127.0.0.1 --port 2881 --user root --password ''
```

输出 `导入 3 篇笔记到 127.0.0.1:2881/notes` 即成功。

### 4.3 启动应用

```bash
python app.py --host 127.0.0.1 --port 2881 --user root --password '' --http-port 8000
```

浏览器打开 **http://127.0.0.1:8000/**，输入 `特征值`、`三次握手`、`负权边` 试试。

## 5. 接口

| 接口 | 说明 |
|---|---|
| `GET /` | 网页搜索框 |
| `GET /api/search?q=特征值` | JSON 结果：标题、来源文件、标签、片段、相关度、检索方式 |
| `GET /api/stats` | 笔记条数与来源数 |

## 6. 验证样例

见 [`samples.md`](samples.md)：4 组用例，覆盖命中、跨笔记、无结果三种情况，并说明如何核对 seekdb 的实际作用。

## 7. Qoder 开发记录

- `docs/qoder-devlog.md`：需求拆解 → 编码 → 调试的对话记录要点（**需替换为你的真实截图**）
- Qoder 账号 UID：`<在此填写你的 UID>`（提交平台时需要）

> 说明：项目源码结构与文档由参赛者在 Qoder 中完成；本目录保留可直接运行的版本与复现步骤。

## 8. 已知限制

- 全文索引不可用时自动退回 `LIKE` 打分，结果仍可用，但排序质量下降。
- 只支持 Markdown 纯文本；PDF/图片需要先转文本。
- 中文分词依赖 seekdb 的全文能力；若分词效果不理想，可改用更短的关键词。
- 无鉴权，仅面向本机/内网演示，不要直接暴露到公网。

## 9. 目录

```
qoder/
├── app.py                # Web 应用（stdlib http.server + pymysql）
├── seed_notes.py         # 导入 notes/*.md 到 seekdb
├── notes/                # 示例笔记（3 篇）
├── requirements.txt
├── README.md
├── samples.md            # 验证样例
└── docs/qoder-devlog.md  # Qoder 开发记录（需补截图与 UID）
```

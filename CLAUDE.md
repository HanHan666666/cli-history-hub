# CLAUDE.md

## 项目概述

Claude Code History Viewer — 本地 Web 应用，浏览和管理 Claude Code CLI 的对话历史。
Node.js + Express 后端，原生 JS 前端，无数据库，直接读取 `~/.claude/projects/` 下的 JSONL 文件。

## 启动命令

```bash
npm install    # 安装依赖（仅 express）
node server.js # 启动服务，http://localhost:3456
```

## 项目结构

```
server.js                 # 全部后端逻辑（Express + 7 个 API + JSONL 解析 + 缓存）
public/
  index.html              # SPA 入口（4 视图 + 4 弹窗）
  style.css               # 全局 CSS，暗色主题
  app.js                  # 主应用（window.App）：状态管理、视图切换、项目/会话列表
  modules/
    router.js             # Hash 路由（window.Router）
    chat-view.js          # 消息渲染 + 分页（window.ChatView）
    search.js             # 全局搜索弹窗（window.Search）
    stats.js              # 统计面板 + Canvas 图表（window.Stats）
    features.js           # 重命名/标签/收藏/导出（window.Features）
docs/                     # 项目文档（详见 docs/README.md）
```

## 核心开发规范

1. **只读 JSONL** — `~/.claude/projects/` 下的 `.jsonl` 文件只读不写。用户数据（重命名、标签、收藏）写入独立的 `session-meta/*.json` sidecar 文件。
2. **轻量前端** — 原生 JS + CSS，不引入 React/Vue 等框架，不使用构建工具。模块通过 `window.*` 全局对象通信。
3. **唯一依赖** — 后端只依赖 express，不引入额外 npm 包除非必要。
4. **安全** — 后端读取文件时必须校验路径合法性，防止目录遍历。不暴露非日志相关的系统文件。

## 前端模块通信

- 模块在 `index.html` 中按顺序加载：router → search → chat-view → stats → features → app
- 各模块暴露为 `window.Router`、`window.Search`、`window.ChatView`、`window.Stats`、`window.Features`
- `app.js`（`window.App`）是主编排器，调用各模块的 `init()` 并暴露共享工具函数：`api()`, `escapeHtml()`, `formatDate()`, `formatTime()`, `showView()`, `showToast()`
- Router ↔ App 双向调用，用 `_routerDriven` 和 `_navigating` 标志防止循环

## 7 个 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/:pid/sessions-full` | 会话元数据列表（带缓存） |
| GET | `/api/projects/:pid/sessions/:sid` | 会话消息（支持 `?page=N&pageSize=30` 分页） |
| PUT | `/api/projects/:pid/sessions/:sid/meta` | 更新 sidecar 元数据 |
| GET | `/api/search?q=keyword&project=pid` | 全文搜索（最多 50 条） |
| GET | `/api/stats?project=pid` | Token 用量统计 |
| GET | `/api/tags` | 所有已用标签 |

## 数据层要点

- **缓存**：`sessionCache`（Map）按 JSONL 文件路径缓存会话元数据，通过 mtime + sidecar mtime 失效
- **消息合并**：连续 assistant 消息合并为一个 turn（blocks 拼接、usage 累加）
- **XML 清理**：用户消息去除 `<system-reminder>` 等 Claude Code 注入的 XML 标签
- **智能标题**：customName > 有意义的 firstPrompt > displayName > "Untitled"

## 修改代码时注意

- 后端所有逻辑在 `server.js` 单文件中，修改时注意函数间的依赖关系
- 前端修改样式只改 `style.css`，不要加 inline style
- 新增前端模块：在 `public/modules/` 创建文件 → `index.html` 中 `app.js` 前添加 script → `app.js` 的 `init()` 中调用
- sidecar 增加新字段：改 PUT /meta 路由 → 改 extractSessionMeta() → 改前端对应模块
- 完整文档索引见 [docs/README.md](docs/README.md)

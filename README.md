# Claude Code History Viewer

一个本地 Web 应用，用于浏览、搜索和管理 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 产生的对话历史。

直接读取 `~/.claude/projects/` 下的 JSONL 会话文件，提供可视化界面，无需数据库。

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## 功能

- **项目浏览** — 按项目分组查看所有会话，支持时间分组（Today / Yesterday / This Week...）
- **分支筛选** — 按 git 分支过滤会话列表
- **对话详情** — 完整渲染消息（文本 / 思考过程 / 工具调用），支持折叠展开
- **全局搜索** — `Cmd+K` 全文搜索所有对话内容，关键词高亮
- **会话管理** — 重命名、收藏置顶、自定义标签
- **导出** — Markdown / JSON 文件下载，或复制到剪贴板
- **Token 统计** — 用量汇总、每日柱状图、按项目/模型分类明细
- **URL 路由** — Hash 路由支持浏览器前进/后退和直接链接分享

## 快速开始

```bash
git clone https://codeup.aliyun.com/686267de0efe727709628fea/gbr/claude-history-viewer.git
cd claude-history-viewer
npm install
node server.js
```

浏览器打开 http://localhost:3456

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + Express 4.x |
| 前端 | 原生 JavaScript + [marked.js](https://github.com/markedjs/marked)（Markdown 渲染） |
| 图表 | Canvas 2D API（自绘柱状图） |
| 数据 | 文件系统（JSONL + JSON sidecar，无数据库） |
| 样式 | 原生 CSS，暗色主题 |

## 项目结构

```
claude-history-viewer/
  server.js                 # 后端：Express 服务器 + 7 个 API + 数据解析
  package.json              # 项目配置（唯一依赖：express）
  public/
    index.html              # SPA 入口（4 视图 + 4 弹窗）
    style.css               # 全局样式
    app.js                  # 主应用（状态管理、视图切换、列表渲染）
    modules/
      router.js             # Hash 路由
      chat-view.js          # 消息渲染 + 分页
      search.js             # 全局搜索弹窗
      stats.js              # 统计面板 + Canvas 图表
      features.js           # 重命名 / 标签 / 收藏 / 导出
  docs/                     # 项目文档
```

## 数据来源

本应用**只读取** Claude Code 原生产生的 `.jsonl` 会话文件，不修改它们。

用户在 Viewer 中添加的元数据（重命名、标签、收藏）存储在独立的 sidecar 文件中：

```
~/.claude/projects/{project-dir}/session-meta/{session-id}.json
```

## API

共 7 个后端接口，详见 [API 参考文档](docs/api-reference.md)。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/:pid/sessions-full` | 会话元数据列表 |
| GET | `/api/projects/:pid/sessions/:sid` | 会话消息（支持分页） |
| PUT | `/api/projects/:pid/sessions/:sid/meta` | 更新会话元数据 |
| GET | `/api/search` | 全文搜索 |
| GET | `/api/stats` | Token 用量统计 |
| GET | `/api/tags` | 标签列表 |

## 文档

完整的项目文档在 [docs/](docs/README.md) 目录下：

- [技术架构](docs/architecture.md) — 技术栈、模块关系、数据流
- [浏览与导航](docs/browse-and-navigate.md) — 项目列表、会话列表、时间分组、路由
- [对话详情](docs/conversation-detail.md) — 消息渲染、消息合并、分页
- [搜索](docs/search.md) — 全局搜索、列表内搜索
- [会话管理](docs/session-management.md) — 重命名、收藏、标签
- [导出](docs/export.md) — Markdown / JSON / 剪贴板
- [统计面板](docs/stats.md) — Token 统计、图表
- [数据存储](docs/data-storage.md) — JSONL 解析、sidecar、缓存
- [API 参考](docs/api-reference.md) — 7 个接口完整文档

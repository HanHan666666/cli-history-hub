# Claude Code History Viewer

## 项目简介

Claude Code History Viewer 是一个本地 Web 应用，用于浏览、搜索和管理 Claude Code CLI 产生的对话历史。它直接读取 `~/.claude/projects/` 下的 JSONL 会话文件，提供项目分组、时间线浏览、全文搜索、会话管理和 Token 用量统计等功能。面向 Claude Code 用户，帮助回顾和整理日常的 AI 编程对话。

## 快速开始

```bash
cd claude-history-viewer
npm install
node server.js
# 浏览器打开 http://localhost:3456
```

## 功能导航

按业务场景索引所有功能文档：

### 浏览对话

- [浏览与导航](browse-and-navigate.md) - 项目列表、会话列表、时间分组（Today/Yesterday/This Week...）、分支筛选、列表内搜索、URL 路由

### 查看对话

- [对话详情](conversation-detail.md) - 消息渲染（文本/思考/工具调用）、连续助手消息合并、分页加载

### 搜索

- [搜索](search.md) - 全局全文搜索（Cmd+K）、列表内搜索

### 管理会话

- [会话管理](session-management.md) - 重命名、收藏/置顶、标签管理
- [导出](export.md) - Markdown/JSON 文件下载、剪贴板复制

### 数据统计

- [统计面板](stats.md) - Token 用量汇总、每日柱状图、按项目/模型分类明细

### 开发者参考

- [技术架构](architecture.md) - 技术栈、前后端模块关系、数据流
- [数据存储](data-storage.md) - JSONL 解析、sidecar 元数据、内存缓存
- [API 参考](api-reference.md) - 7 个后端接口完整文档

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + Express 4.x |
| 前端 | 原生 JavaScript + marked.js (Markdown 渲染) |
| 图表 | Canvas 2D API（自绘柱状图） |
| 数据 | 文件系统（JSONL + JSON sidecar，无数据库） |
| 样式 | 原生 CSS，暗色主题 |

## 项目结构

```
claude-history-viewer/
  server.js                       # 后端：Express 服务器 + API + 数据解析
  package.json                    # 项目配置（唯一依赖：express）
  public/
    index.html                    # SPA 入口（4 视图 + 4 弹窗）
    style.css                     # 全局样式
    app.js                        # 主应用（状态管理、视图切换、列表渲染）
    modules/
      router.js                   # Hash 路由
      chat-view.js                # 消息渲染 + 分页
      search.js                   # 全局搜索弹窗
      stats.js                    # 统计面板 + Canvas 图表
      features.js                 # 重命名/标签/收藏/导出
  docs/                           # 本文档目录
    README.md                     # 项目总览（本文件）
    architecture.md               # 技术架构
    browse-and-navigate.md        # 浏览与导航
    conversation-detail.md        # 对话详情
    search.md                     # 搜索
    session-management.md         # 会话管理
    export.md                     # 导出
    stats.md                      # 统计面板
    data-storage.md               # 数据存储
    api-reference.md              # API 接口参考
```

## 文档交叉引用关系

```
README.md（本文件 - 根入口，链接所有文档）
  │
  ├── architecture.md ←──────────── 被所有文档引用（了解整体架构）
  │
  ├── browse-and-navigate.md
  │     ↔ search.md（搜索结果跳转到会话）
  │     ↔ conversation-detail.md（点击会话进入详情）
  │     ↔ session-management.md（收藏影响列表排序）
  │     → data-storage.md（会话元数据来源）
  │
  ├── conversation-detail.md
  │     → data-storage.md（JSONL 消息解析）
  │     ↔ export.md（导出当前对话内容）
  │     ↔ session-management.md（详情页的管理按钮）
  │
  ├── search.md
  │     → api-reference.md（搜索 API）
  │     ↔ browse-and-navigate.md（搜索结果导航）
  │
  ├── session-management.md
  │     → data-storage.md（sidecar 存储）
  │     ↔ browse-and-navigate.md（收藏 → Pinned 分组）
  │     ↔ conversation-detail.md（详情页按钮）
  │
  ├── export.md
  │     ↔ conversation-detail.md（导出的数据来源）
  │
  ├── stats.md
  │     → data-storage.md（token 数据来源）
  │     → api-reference.md（stats API）
  │
  ├── data-storage.md ←──────────── 被多个功能文档引用（底层数据支撑）
  │
  └── api-reference.md ←─────────── 被功能文档按需引用（API 细节）
```

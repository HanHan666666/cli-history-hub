# 对话详情

## 概述

用户点击会话卡片后进入对话详情页，查看完整的对话消息，包括用户提问、助手回复（文本/思考/工具调用）、Token 用量等信息。

## 关联功能

- [浏览与导航](browse-and-navigate.md) - 从会话列表点击进入详情
- [搜索](search.md) - 搜索结果点击后跳转到对话详情
- [导出](export.md) - 导出当前对话的消息内容
- [会话管理](session-management.md) - 详情页头部的重命名/标签/收藏按钮
- [数据存储](data-storage.md) - JSONL 消息解析和消息合并逻辑
- [API 参考](api-reference.md) - 会话详情的 API 端点（含分页）
- [技术架构](architecture.md) - ChatView 模块在前端架构中的位置

## 功能细节

### 消息渲染

每条消息渲染为一个 "turn"（轮次），分用户轮和助手轮。

**用户轮 (User Turn)：**
- 角色标签 "User"
- 时间戳（MM/DD HH:mm 格式）
- 消息文本（经 Markdown 渲染）
- 空消息（`text` 为空或纯空白）不渲染

**助手轮 (Assistant Turn)：**
- 角色标签显示模型名称（如 `claude-sonnet-4-6-20260319`）
- 时间戳
- Token 用量（output_tokens，格式化为带逗号的数字）
- 内容区包含多种 block：

| Block 类型 | 渲染方式 |
|-----------|---------|
| `text` | Markdown 渲染（使用 marked.js） |
| `thinking` | 可折叠区域，默认收起，显示前 100 字符预览 |
| `tool_use` | 可折叠区域，显示工具名称，展开显示 JSON 格式的输入参数 |

**折叠/展开交互：**
- 点击 thinking/tool 的标题行切换展开状态
- 通过 CSS 类 `show` 控制内容区显示
- 箭头图标旋转指示状态（`arrow` + `open` 类）

### 消息合并

后端在解析 JSONL 时，将连续的 assistant 消息合并为一个 turn。

**合并规则：**
- 条件：当前消息和前一条都是 `type === 'assistant'`
- `blocks` 数组拼接
- `timestamp` 取较晚的
- `model` 取后者的（如果存在）
- `usage` 各字段累加（input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens）
- `gitBranch` 取第一个非空值

**为什么需要合并：** Claude Code 的一个回复可能产生多条 JSONL 行（如文本回复 + 工具调用 + 继续回复），这些在逻辑上属于同一个 turn。

### 分页加载

消息列表支持分页，避免大型对话一次加载过多消息。

**分页策略：**
- 默认不分页，一次返回所有消息
- 指定 `page` 参数时启用分页（`pageSize` 默认 30）
- `page=1` 是最新消息，`page=N` 是最旧消息
- 页面顶部显示 "Load earlier messages" 按钮

**加载更多流程：**
1. 点击 "Load earlier messages"
2. 请求 `GET /api/projects/{pid}/sessions/{sid}?page={nextPage}&pageSize=30`
3. 将旧消息 prepend 到消息容器顶部
4. 保持当前滚动位置不变（`scrollTop = newScrollHeight - prevScrollHeight`）
5. 更新分页状态，如果已到最后一页则隐藏按钮

**初始加载行为：**
- `ChatView.render()` 完成后滚动到容器顶部（`scrollTop = 0`）
- `App.openSession()` 完成后滚动到容器底部（`scrollTop = scrollHeight`）
- 实际效果：app.js 的 scrollBottom 覆盖了 ChatView 的 scrollTop

### 对话头部信息

详情页头部包含：
- 返回按钮（← 回到会话列表）
- 收藏星标按钮
- 会话标题（使用 `smartTitle` 逻辑）
- 重命名按钮
- 标签按钮 + 导出按钮
- 元信息行：日期、消息数、git 分支
- 标签展示区

## 涉及的代码

| 位置 | 文件 | 关键函数/行号 |
|------|------|--------------|
| 前端 | public/modules/chat-view.js:38-69 | `render()` - 渲染消息列表 |
| 前端 | public/modules/chat-view.js:74-128 | `loadMore()` - 加载更多消息 |
| 前端 | public/modules/chat-view.js:134-156 | `getMessagesForExport()` - 导出用数据 |
| 前端 | public/modules/chat-view.js:177-191 | `createUserTurn()` |
| 前端 | public/modules/chat-view.js:196-231 | `createAssistantTurn()` |
| 前端 | public/modules/chat-view.js:236-263 | `createThinkingBlock()`, `createToolBlock()` |
| 前端 | public/modules/chat-view.js:269-292 | `bindToggleEvents()` |
| 前端 | public/app.js:514-576 | `openSession()` - 加载会话数据 + 初始化头部 |
| 前端 | public/app.js:626-663 | `setupChatHeader()` |
| 后端 | server.js:217-277 | `parseSessionMessages()` - 消息解析 + 合并 |
| 后端 | server.js:399-457 | `GET /api/projects/:pid/sessions/:sid` |

## API 接口

- `GET /api/projects/:pid/sessions/:sid?page=1&pageSize=30` → [API 参考](api-reference.md#session-detail)

## 修改指南

### 如果要支持新的 block 类型

1. 后端 `server.js` 的 `formatAssistantMessage()` 中添加新 block 类型的格式化
2. 前端 `chat-view.js` 的 `createAssistantTurn()` 中添加新 block 类型的渲染
3. 如果新 block 可折叠，创建对应的 `create*Block()` 函数 + CSS 样式
4. 在 `bindToggleEvents()` 中绑定新 block 的折叠事件

### 如果要修改分页策略

1. 后端分页逻辑在 `server.js:418-441`（page 从尾部切片）
2. 前端分页状态在 `chat-view.js:10-13`（`_currentPage`, `_totalPages`）
3. 加载更多逻辑在 `chat-view.js:74-128`
4. 注意滚动位置保持的逻辑（`prevScrollHeight`）

### 如果要修改消息合并规则

1. 合并逻辑在 `server.js:246-274`（`parseSessionMessages` 中的 merged 循环）
2. 注意 usage 的累加和 blocks 的拼接顺序
3. 修改后需检查导出功能是否正确

## 已知问题 / TODO

- [ ] 初始加载时 ChatView 和 App 的滚动行为冲突
- [ ] thinking 和 tool_use 的内容没有 Markdown 渲染
- [ ] 没有消息搜索（在当前对话中搜索）
- [ ] 没有消息复制按钮
- [ ] 分页加载没有 loading 状态提示

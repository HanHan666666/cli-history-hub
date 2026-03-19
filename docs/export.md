# 导出

## 概述

用户可以将当前对话导出为 Markdown 文件、JSON 文件或复制到剪贴板。

## 关联功能

- [对话详情](conversation-detail.md) - 导出的数据来自当前加载的对话消息
- [会话管理](session-management.md) - 导出按钮位于详情页头部的管理区域
- [技术架构](architecture.md) - 导出功能由 Features 模块实现

## 功能细节

### 导出弹窗

**触发：** 详情页头部的导出按钮（&#128228; Export）

**三个选项：**
| 选项 | 图标 | 说明 |
|------|------|------|
| Markdown (.md) | &#128196; | 下载 .md 文件 |
| Copy to Clipboard | &#128203; | 复制 Markdown 格式文本到剪贴板 |
| JSON (.json) | &#128190; | 下载 .json 文件 |

**关闭：** 点 Close / 点遮罩层 / 按 Escape

### Markdown 导出

生成结构化的 Markdown 文本：

```markdown
# Session: 会话标题
Date: 2026/03/19 | Branch: main
---

## User

用户的消息文本

## Assistant (claude-sonnet-4-6-20260319)

助手的回复文本

> *[Thinking]*: 思考内容前200字符...

> *[Tool: Write]*
```

**格式规则：**
- 标题用 `# Session: {title}`
- 元信息（日期、分支）放在标题下方
- 每条消息用 `## User` 或 `## Assistant ({model})` 分隔
- thinking block 缩进为引用 + 斜体，截断到 200 字符
- tool_use block 缩进为引用 + 斜体，只显示工具名

### JSON 导出

直接将消息数组序列化为格式化 JSON：

```json
[
  {
    "type": "user",
    "text": "帮我写代码",
    "timestamp": "2026-03-19T10:00:00Z"
  },
  {
    "type": "assistant",
    "model": "Claude",
    "timestamp": "2026-03-19T10:00:05Z",
    "usage": { ... },
    "blocks": [
      { "type": "text", "text": "..." },
      { "type": "thinking", "text": "..." },
      { "type": "tool_use", "name": "Write", "input": { ... } }
    ]
  }
]
```

**数据来源：** `ChatView.getMessagesForExport()` 返回当前已加载的消息（注意：如果未加载全部分页，导出的不是完整对话）。

### 剪贴板导出

复制与 Markdown 导出相同的文本内容到剪贴板。

**实现：**
1. 优先使用 `navigator.clipboard.writeText()`（现代 API）
2. 失败时降级到 `document.execCommand('copy')`（创建隐藏 textarea）
3. 两种方式都会显示 Toast 提示

### 文件下载

使用 Blob + Object URL 触发浏览器下载：
1. 创建 `Blob` 对象
2. `URL.createObjectURL()` 生成临时 URL
3. 创建 `<a>` 元素设置 `download` 属性
4. 触发 click，然后 `URL.revokeObjectURL()` 释放

**文件名：** 会话标题经过 sanitize（替换特殊字符为 `_`，截断到 100 字符）+ 扩展名。

## 涉及的代码

| 位置 | 文件 | 关键函数/行号 |
|------|------|--------------|
| 前端 | public/modules/features.js:337-340 | `openExportModal()` |
| 前端 | public/modules/features.js:342-348 | `exportMarkdown()` |
| 前端 | public/modules/features.js:350-365 | `exportCopyToClipboard()` |
| 前端 | public/modules/features.js:367-381 | `fallbackCopy()` |
| 前端 | public/modules/features.js:383-391 | `exportJson()` |
| 前端 | public/modules/features.js:396-442 | `buildMarkdownContent()` - Markdown 文本生成 |
| 前端 | public/modules/features.js:444-449 | `getExportMessages()` - 获取消息数据 |
| 前端 | public/modules/features.js:451-473 | `getSessionTitle()`, `getSessionMeta()` |
| 前端 | public/modules/features.js:571-589 | `downloadFile()`, `sanitizeFilename()` |
| 前端 | public/modules/chat-view.js:134-156 | `getMessagesForExport()` - 数据格式化 |

## 修改指南

### 如果要增加新的导出格式

1. 在 `index.html` 的 `exportModal` 中添加新按钮
2. 在 `features.js` 的 `init()` 中绑定按钮事件
3. 实现新格式的内容生成函数
4. 调用 `downloadFile()` 下载或 `navigator.clipboard` 复制

### 如果要导出完整对话（含未加载的分页）

1. 在导出前先请求所有分页数据（不带 `page` 参数调用 API）
2. 或修改 `getExportMessages()` 在导出时主动请求完整数据
3. 考虑大对话的性能：显示 loading 状态

### 如果要定制 Markdown 格式

1. 修改 `buildMarkdownContent()` 中的模板逻辑
2. thinking block 和 tool_use block 的渲染在函数的 forEach 内
3. 注意 `getSessionMeta()` 解析元信息的格式依赖 chatMeta 元素的文本

## 已知问题 / TODO

- [ ] 导出的是当前已加载的消息，未加载的分页不包含
- [ ] Markdown 导出中 thinking 只取前 200 字符
- [ ] 没有 PDF 导出选项
- [ ] 没有导出所有对话的批量功能
- [ ] JSON 导出没有包含会话元数据（标题、标签等）

# Gemini AI Assistant Configuration

**核心规则：全程说中文**

---

## 项目背景 (Project Context)
本项目是一个基于 Node.js 和 Express 开发的 **Claude Code 会话历史记录查看器**。
它的主要作用是读取你的本地目录（`~/.claude/projects/`）中的 `.jsonl` 格式对话历史文件，并在本地启动一个 Web 服务，提供可视化界面以供在浏览器中查询、浏览所有的对话记录和详细交互过程。

## 技术栈与目录结构 (Tech Stack & Structure)
- **后端服务端**: Node.js + Express
  - Node 版本要求：建议使用 `Node.js 22.14.0`（通过 `.nvmrc` 或最新稳定版），最低兼容 `>=8.9`。
  - 入口文件：`server.js`，启动后监听本地 `3456` 端口。
- **前端页面**: 原生 HTML / CSS / Vanilla JavaScript
  - 代码位置：主要集中在独立的 `public/` 目录下（包含 `app.js`、`style.css`、`index.html`）。
  - 没有复杂的脚手架和构建工具链（如 Webpack、Vite 等），即改即生效。

## AI 协助开发与修改规范 (Guidelines for AI)
为了在后续的 AI （特别是 Gemini）协助开发中保持该项目的风格一致性和安全性，请始终遵循以下开发指导原则：

1. **坚持只读原则处理核心日志**：主要的历史记录数据来源于 Claude。在任何涉及 `~/.claude/projects/` 目录下 `.jsonl` 文件的逻辑中，必须坚持“只读不写”的设定。唯一允许写入的数据是独立的侧载数据（如通过重命名产生的 `session-meta/*.json` 文件）。
2. **轻量级、原生化前端**：在为前端增加新功能、修改样式时，请继续使用当前原生的 API（DOM 操作）和原生的 CSS，**不要引入任何需要编译或打包的外部大型框架（如 React/Vue）**。保持其轻量和纯粹的特性。
3. **安全与路径校验**：当后端需要根据前端传入的文件 `id`、项目名等信息读取文件系统时，请始终进行路径合法性验证（防范目录遍历漏洞），绝不可向外暴露任何非日志相关级别的本地系统文件。

## 项目依赖与启动命令 (Setup & Run)
如果是首次运行或补充了新的依赖，请先安装：
```bash
npm install
```

启动本地查看服务端：
```bash
npm start
```

启动成功后，浏览器访问 `http://localhost:3456` 即可查看图形化界面。

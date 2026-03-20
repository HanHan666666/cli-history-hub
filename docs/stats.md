# 统计面板

## 概述

展示 Claude Code 和 Codex CLI 的 Token 使用统计数据，包括汇总卡片、每日用量柱状图、按项目和模型的分类明细。统计数据同时包含两个数据源。

## 关联功能

- [数据存储](data-storage.md) - Token 数据来源于 JSONL 文件中 assistant 消息的 usage 字段
- [API 参考](api-reference.md) - 使用 `/api/stats` 端点
- [浏览与导航](browse-and-navigate.md) - 通过侧边栏按钮或 URL 路由进入统计页
- [技术架构](architecture.md) - Stats 模块在前端架构中的位置
- [Codex CLI 集成](codex-integration.md) - 统计数据包含 Codex 用量

## 功能细节

### 进入方式

- 侧边栏的 "Stats" 按钮
- 直接访问 URL `#/stats` 或 `#/stats/{projectId}`

### 项目筛选

页面头部的下拉框可选择查看特定项目或全部项目的统计。切换时重新请求数据。

### 时间范围筛选

页面头部的时间范围下拉框支持选择：
- Last 7 days
- Last 14 days
- Last 30 days（默认）
- Last 60 days
- Last 90 days
- Last 180 days
- Last 365 days

切换时重新请求数据，图表自动适应数据量。

### 汇总卡片

显示 6 个指标卡片：

| 卡片 | 数据来源 |
|------|---------|
| Total Input Tokens | `totalTokens.input` |
| Total Output Tokens | `totalTokens.output` |
| Cache Creation | `totalTokens.cacheCreation` |
| Cache Read | `totalTokens.cacheRead` |
| Total Sessions | `totalSessions` |
| Total Messages | `totalMessages` |

数字格式化为带逗号的形式（如 1,234,567）。

### 每日 Token 用量图表

使用 Canvas 2D API 自绘的堆叠柱状图，展示选定时间范围内每日的 token 用量。

**图表特性：**
- 堆叠柱状图：绿色（Input tokens）在上，蓝色（Output tokens）在下
- Y 轴自动缩放到"漂亮"的数值（1/2/5/10 的倍数）
- Y 轴标签使用 K/M 缩写（如 1.2K, 1.5M）
- X 轴显示日期（MM-DD 格式），避免拥挤时间隔显示
- 5 条水平网格线
- 支持高 DPI 屏幕（`devicePixelRatio` 缩放）
- **悬浮显示 tooltip**：鼠标悬停在柱子上显示日期、input tokens、output tokens、cache creation、cache read
- 图例显示 Input 和 Output 的颜色说明
- 无数据时显示 "No token usage data available"

**Y 轴 "nice round up" 算法：**
1. 取最大值的数量级（10^n）
2. 归一化到 1-10 范围
3. 向上取到 1/2/5/10 中最近的值

### 分类明细

两个表格展示详细的分类统计：

**按项目 (By Project)：**

| 列 | 说明 |
|----|------|
| Project | 项目名（长路径截取最后两段） |
| Input Tokens | 该项目的输入 Token 总量 |
| Output Tokens | 该项目的输出 Token 总量 |

按总 Token 量降序排列。

**按模型 (By Model)：**

| 列 | 说明 |
|----|------|
| Model | 模型名称 |
| Messages | 使用该模型的助手消息数 |
| Output Tokens | 该模型的输出 Token 总量 |

按消息数降序排列。

### 数据导出

点击 "Export to CSV" 按钮可导出统计数据为 CSV 文件，包含：
- 汇总数据（Total tokens、sessions、messages）
- 每日用量明细
- 按项目分类
- 按模型分类

文件名格式：`cli-history-stats-YYYY-MM-DD.csv`

### 返回导航

返回按钮的行为根据之前的视图状态决定：
- 有当前会话 → 回到对话详情
- 有当前项目 → 回到会话列表
- 都没有 → 回到欢迎页

## 涉及的代码

| 位置 | 文件 | 关键函数/行号 |
|------|------|--------------|
| 前端 | public/modules/stats.js:20-60 | `init()` - 事件绑定 |
| 前端 | public/modules/stats.js:66-120 | `show()` - 加载并渲染统计数据 |
| 前端 | public/modules/stats.js:126-145 | `populateProjectFilter()` |
| 前端 | public/modules/stats.js:151-180 | `renderSummaryCards()` |
| 前端 | public/modules/stats.js:186-380 | `renderDailyChart()` - Canvas 堆叠柱状图 |
| 前端 | public/modules/stats.js:385-460 | `setupDailyChartTooltip()` - 悬浮提示 |
| 前端 | public/modules/stats.js:465-480 | `niceRoundUp()` - Y 轴刻度算法 |
| 前端 | public/modules/stats.js:486-600 | `renderBreakdown()` - 分类表格 |
| 前端 | public/modules/stats.js:602-680 | `exportStatsToCSV()` - CSV 导出 |
| 后端 | server.js:1069-1300 | `GET /api/stats` |

## API 接口

- `GET /api/stats?project=projectId&days=30` → [API 参考](api-reference.md#stats)

## 修改指南

### 如果要增加新的统计维度

1. 后端 `server.js` 的 `/api/stats` 路由中添加新的聚合逻辑
2. 在响应 JSON 中添加新字段
3. 前端 `stats.js` 中添加新的渲染函数（卡片 or 表格 or 图表）
4. 更新 [API 参考](api-reference.md#stats) 文档

### 如果要修改图表类型

1. `renderDailyChart()` 是纯 Canvas 2D 绘制
2. 如果要改为折线图：替换 `fillRect` 为 `lineTo` + `stroke`
3. 如果要引入图表库（如 Chart.js）：
   - 在 `index.html` 添加 CDN 引用
   - 替换 `renderDailyChart()` 的实现
   - 删除 `niceRoundUp()` 等辅助函数

### 如果要修改时间范围选项

1. `index.html` 中修改 `statsDaysFilter` 的选项
2. 后端 API 支持 1-365 天范围

## 已知问题 / TODO

- [x] ~~统计 API 没有缓存，每次请求全量扫描~~（已实现 60 秒缓存）
- [x] ~~图表只显示 output tokens，没有 input tokens 对比~~（已实现堆叠柱状图）
- [x] ~~没有 cache_creation 和 cache_read tokens 的可视化~~（已在 tooltip 和汇总卡片中显示）
- [x] ~~没有数据导出功能（导出统计数据为 CSV）~~（已实现）
- [x] ~~每日图表固定 30 天，不能自定义时间范围~~（已支持 7/14/30/60/90/180/365 天）

### 最近优化记录 (Recent Updates)
- **API 缓存**：统计 API 实现 60 秒内存缓存，减少重复扫描开销
- **堆叠柱状图**：每日图表改为堆叠显示 Input（绿色）和 Output（蓝色）tokens
- **Cache tokens 可视化**：汇总卡片新增 Cache Creation 和 Cache Read，tooltip 显示详细数据
- **CSV 导出**：支持导出完整统计数据为 CSV 文件
- **自定义时间范围**：支持 7 天到 365 天的时间范围选择
- **看板交互穿越**：`By Project` 的报表行支持 hover 态与点击穿越，附带 `projectId` 触发 Router 单页无缝跳转回该项目的对话列表。
- **多模型财务饼图 (Model Analytics)**：
  - 弃用基础的模型文本表格，在右侧新增基于纯原生 Vanilla JS 实现的 Canvas 甜甜圈图（Doughnut Chart）及交互式 Hover 图例。
  - 首创 `Cost($) vs Tokens` 业务视图解耦。前端内置定价映射表，支持一键切换评估 "吃量模型" 与 "烧钱模型" 的占比落差，极大增强视觉冲击和洞察力。

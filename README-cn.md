# 九连棋 AI

一款基于浏览器的九子棋（Nine Men's Morris）游戏，配备具有动态策略、隐藏陷阱检测和人格化旁白系统的高级 AI 对手。

> **GitHub 项目信息**
> - **项目名称:** `nine-mens-morris-ai`
> - **项目简介:** 基于浏览器的九子棋游戏，内置 Minimax AI、动态策略状态机、隐藏陷阱检测和人格旁白系统——零依赖，纯原生 JS 实现。

## 功能特性

- **完整游戏规则** — 布置阶段、移动阶段、飞行阶段全部实现
- **三种 AI 难度模式：**
  - **Eco（经济模式）** — 搜索深度 1，轻松随意，适合新手
  - **Normal（普通模式）** — 搜索深度 3，启用陷阱检测，均衡挑战
  - **Master（大师模式）** — 搜索深度 4，陷阱检测，近乎确定性决策
- **动态策略状态机** — 根据局势自动切换扩张、压制、致命一击三种战术模式
- **隐藏陷阱检测** — 通过深度差距评估，发现浅层看起来糟糕但深层实则精妙的走法（depth-gap evaluation）
- **人格旁白系统** — AI 根据情绪状态（傲慢、自信、中性、谨慎、绝望）输出中文对话；支持接入 LLM 生成更丰富的旁白
- **战术报告系统** — 输出结构化 JSON 报告，包含指标、评分走法和语义标签
- **悔棋功能** — 人类玩家可撤销走法（同时回退 AI 和人类的落子）
- **响应式 SVG 界面** — 自动适应竖屏和横屏布局
- **AI 对战框架** — 支持不同难度模式之间的自动对弈测试

## 技术栈

- **原生 JavaScript**（ES6+，IIFE 模块模式）
- **HTML5 / CSS3** — 单页应用，响应式布局
- **内联 SVG** — 棋盘渲染，无外部资源依赖
- **零依赖** — 无 npm 包、无打包工具、无框架

## 项目结构

```
├── index.html          # 游戏界面 + 控制器（HTML/CSS/JS）
├── engine.js           # 核心游戏引擎（状态、规则、走法生成）
├── strategy.js         # 战术分析层（机动性、张力、报告）
├── ai.js               # AI 控制器（极小化极大搜索、Alpha-Beta 剪枝、策略模式）
├── narrator.js         # 人格旁白系统
├── test/
│   ├── test_undo.js        # 悔棋压力测试（100 次随机循环）
│   ├── test_strategy.js    # 策略层单元测试
│   ├── test_ai.js          # AI 单元测试
│   ├── test_narrator.js    # 旁白系统测试
│   ├── test_perf.js        # 性能基准测试
│   ├── battle.js           # AI 对战运行器
│   └── run_battles.sh      # 批量对战脚本
├── PRD-NineMensMorris.md   # 架构设计文档
├── AI-Master.md            # 大师级 AI 设计规范
└── chat.md                 # 开发笔记
```

## 快速开始

无需构建步骤，直接在浏览器中打开：

```bash
# 方式一：直接用浏览器打开 index.html

# 方式二：启动本地服务器
python3 -m http.server 9000
# 或
npx serve -l 9000
```

然后访问 `http://localhost:9000`。

## 运行测试

需要 Node.js 环境：

```bash
cd test
node test_undo.js
node test_strategy.js
node test_ai.js
node test_narrator.js
node test_perf.js
```

## AI 对战

```bash
cd test

# 单次对战：node battle.js <模式1> <模式2> <回合数> <日志文件>
node battle.js Normal Master 1 battle.log

# 批量对战（5 场并行 Eco vs Eco）
bash run_battles.sh
```

## 架构设计

代码采用分层模块架构，使用 IIFE 揭示模块模式：

```
Engine（游戏状态、规则、走法生成）
  └─ Strategy（战术分析、机动性、张力评估）
       └─ AI（极小化极大搜索、Alpha-Beta 剪枝、策略模式切换）
            └─ Narrator（情绪系统、对话生成）
```

`index.html` 中的游戏控制器负责协调所有模块。

## AI 设计亮点

| 概念 | 说明 |
|------|------|
| **Minimax + Alpha-Beta** | 经典对抗搜索算法，配合剪枝优化性能 |
| **动态搜索深度** | 根据策略模式自动调整搜索深度（1–4 层） |
| **策略状态机** | 扩张 → 压制 → 致命一击，由子力差和机动性驱动 |
| **隐藏陷阱** | `TrapScore = Score(深层) - Score(浅层)` — 发现非显而易见的致胜走法 |
| **温度参数** | 控制走法随机化程度 — Eco 高温，Master 低温 |
| **有效机动性** | 只计算不会立即丢子的走法（而非原始机动性） |

## 浏览器兼容性

支持所有现代浏览器（ES6+）。已在 Chrome、Firefox、Safari、Edge 上测试通过。

## 许可证

MIT

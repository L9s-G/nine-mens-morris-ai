# Nine Men's Morris AI 引擎

纯原生 JavaScript 实现的九子棋（Nine Men's Morris）AI 引擎，包含极小化极大搜索、动态策略状态机、隐藏陷阱检测和人格化旁白系统。零依赖。

## 功能特性

- **完整游戏引擎** — 布置、移动、飞行三阶段全覆盖；完整走法生成与悔棋支持
- **三种 AI 难度模式：**
  - **Eco（经济模式）** — 搜索深度 1，高温度随机化，适合新手
  - **Normal（普通模式）** — 搜索深度 3，启用陷阱检测，均衡挑战
  - **Master（大师模式）** — 搜索深度 4，陷阱检测，近乎确定性决策
- **动态策略状态机** — 根据子力差、机动性差距和游戏阶段，自动切换扩张、压制、决战三种战术模式
- **隐藏陷阱检测** — 深度差距评估，发现浅层看起来糟糕但深层实则致胜的走法
- **人格旁白系统** — 根据情绪状态（傲慢/自信/中性/谨慎/绝望）输出中文对话；支持离线词库和接入 LLM
- **战术报告系统** — 结构化 JSON 输出，包含局势上下文、指标、评分走法和语义标签
- **加权随机选择** — 基于 Softmax 分布的走法选择，每个难度可配置温度参数
- **搜索时间保护** — 5 秒搜索上限，每 1000 节点检查一次时间

## 技术栈

- **原生 JavaScript**（ES6+，IIFE 模块模式）
- **零依赖** — 无 npm 包、无打包工具、无框架

## 项目结构

```
├── engine.js           # 核心游戏引擎（状态、规则、走法生成、悔棋）
├── strategy.js         # 战术分析层（有效机动性、阵型张力、报告生成）
├── ai.js               # AI 控制器（极小化极大、Alpha-Beta 剪枝、策略模式、陷阱检测）
├── narrator.js         # 人格旁白系统（离线词库 + LLM Prompt）
├── AI-Master.md        # 大师级 AI 设计规范
├── CLAUDE.md           # 项目开发指南
├── test/
│   ├── test_undo.js        # 悔棋压力测试
│   ├── test_strategy.js    # 策略层单元测试
│   ├── test_ai.js          # AI 单元测试
│   ├── test_narrator.js    # 旁白系统测试
│   ├── test_perf.js        # 性能基准测试
│   ├── battle.js           # AI 对战运行器
│   └── run_battles.sh      # 批量对战脚本
└── .gitignore
```

## 架构设计

四层模块架构，使用 IIFE 揭示模块模式：

```
Engine（游戏状态、规则、走法生成、悔棋）
  └─ Strategy（有效机动性、阵型张力、战术报告）
       └─ AI（极小化极大 + Alpha-Beta、策略状态机、陷阱检测）
            └─ Narrator（情绪系统、离线/在线对话生成）
```

每层暴露清晰的公开接口，上层依赖下层，无循环依赖。

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

# 批量对战（并行执行）
bash run_battles.sh
```

## AI 设计亮点

| 概念 | 说明 |
|------|------|
| **Minimax + Alpha-Beta** | 对抗搜索，走法排序优化剪枝效率 |
| **动态搜索深度** | 根据策略模式调整（压制 +1 层，飞行 -1 层） |
| **策略状态机** | 扩张 / 压制 / 决战，由子力差和机动性差距驱动 |
| **隐藏陷阱** | `TrapScore = Score(深层) - Score(浅层)` — 发现欺骗性致胜走法 |
| **Softmax 温度** | 控制走法随机化程度：Eco 高温，Master 接近零 |
| **有效机动性** | 只计算不会立即丢子的走法，而非原始合法走法数 |
| **阶段感知权重** | 随手中棋子减少，评估权重平滑过渡（材料权重 ↓，机动性权重 ↑） |

## 许可证

MIT

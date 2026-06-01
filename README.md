# Nine Men's Morris

纯前端九子棋 AI 对战游戏，零依赖，可离线运行。

**在线体验**：浏览器打开 `index.html`，无需安装。

## 游戏规则

九子棋是两人对弈的古老策略棋盘游戏，棋盘由 24 个交点和连接线组成。

**流程**：

1. **放置阶段**（PLACEMENT）：双方各 9 子，轮流放到棋盘空位
2. **走子阶段**（MOVING）：手上的棋子放完后，沿连线移动到相邻空位
3. **飞行阶段**（FLYING）：场上仅剩 3 子时，可飞行到任意空位

**核心机制**：

- **成磨坊**（Mill）：三子连成一线（横/竖），共 16 条磨坊线
- **吃子**：成行后可吃掉对方一颗棋子（优先吃不在磨坊中的棋子）
- **胜利条件**：将对手棋子减少到 2 颗，或堵死对手所有走法
- **三次重复判和**：同一局面出现三次自动判平局

## 功能特性

- **4 级 AI 难度**：菜鸟 / 老手 / 大师 / 恶魔（Debug 解锁）
- **6 套视觉主题**：荒野余晖、雾灰石板、晨光暖灰、马卡龙、霓虹幻影、暗夜深空（CSS 变量驱动，一键切换）
- **先手选择**：玩家先手或 AI 先手
- **毒舌弹幕系统**：四语台词库（中/英/希/法），加权随机匹配，走前走后双阶段吐槽
- **棋谱导出**：Debug 模式下可复制完整对战记录
- **Debug 模式**：双击棋盘中心显示位置编号和 AI 搜索细节（深度、节点数、耗时、吞吐、温度）
- **响应式设计**：竖屏弹幕叠加、横屏气泡侧栏
- **PWA 支持**：Service Worker 缓存全部资源，完全离线可用
- **游戏存档**：每步自动保存到 localStorage，刷新页面自动恢复

## 项目结构

```
├── index.html            # 入口（SVG 棋盘 + 状态面板 + 模态框）
├── style.css             # 样式（4 套主题 + 响应式 + 动画）
├── engine.js             # 核心引擎（Bitboard 棋盘、规则、走法、FEN 序列化）
├── evaluator.js          # 局面评估（Bitboard 磨坊/机动性分析、深度加权）
├── searcher.js           # 搜索引擎（Minimax + αβ + 迭代加深 + 时间墙）
├── ai.js                 # AI 控制器（难度配置、温度随机选法、Worker 通信）
├── searcher.worker.js    # Web Worker（独立线程执行搜索，不阻塞 UI）
├── taunt.js              # 毒舌弹幕（规则/台词分离、四语台词库、加权随机）
├── game.js               # UI 控制（渲染、交互、动画、设置、存档）
├── service-worker.js     # PWA 离线缓存
├── manifest.json         # PWA 清单
└── test/
    ├── test_engine.js    # 引擎单元测试（59 例）
    ├── test_evaluator.js # 评估器单元测试（30 例）
    ├── battle.js         # AI 对战脚本（Node.js VM 沙箱）
    ├── run_battles.sh    # 循环赛脚本
    ├── analyze.js        # 对战日志分析
    └── battle_logs/      # 对战日志输出（gitignore）
```

## 架构设计

所有模块为 IIFE 全局单例，通过 `<script>` 标签加载，依赖方向单一：

```
┌─────────────────────────────────────────────┐
│  game.js (UI 控制)                          │
│  棋盘渲染 · 交互动画 · 设置管理 · 存档      │
├──────────────┬──────────────────────────────┤
│   ai.js      │       taunt.js              │
│  难度配置    │  规则/台词分离 · 四语台词库  │
│  温度选法    │  加权随机 · 走前走后双阶段   │
│  Worker 通信 │                              │
├──────┬───────┴──────────────────────────────┤
│ searcher.js  │  evaluator.js                │
│ Minimax+αβ   │  Bitboard 磨坊/机动性分析    │
│ 迭代加深     │  popcount/ctz 位扫描         │
│ 时间墙       │  静态评分 · 深度加权          │
├──────┴──────────────────────────────────────┤
│  engine.js (核心引擎)                        │
│  双二进制棋盘 (own/opp Uint32 位掩码)        │
│  预计算掩码表 · 走法生成/执行/撤销 · FEN    │
│  双 Float64Array 环形缓冲区 · 终局判定      │
└─────────────────────────────────────────────┘
```

## Bitboard 棋盘表示

棋盘状态用两个 24 位无符号整数表示：

```
own: 0b000000000000000000000000  ← AI 棋子位掩码（bit i = 1 → AI 在位置 i）
opp: 0b000000000000000000000000  ← 对手棋子位掩码
empty: ~(own | opp) & 0xFFFFFF  ← 空位位掩码
```

### 预计算掩码表

| 表 | 数量 | 用途 |
|----|------|------|
| `MILL_MASKS` | 16 | 每条磨坊线的 24 位掩码（3 位置置 1） |
| `NEIGHBOR_MASKS` | 24 | 每个位置的邻居位掩码 |
| `MILL_WITHOUT` | 24×2 | 每位置 mill 线去掉自身后的 2-bit 掩码 |
| `POSITION_MILLS` | 24 | 每个位置属于哪 2 条 mill 线 |

### 位运算操作

```js
// 判断 pos 是否有棋子
(own >> pos) & 1   // AI？
(opp >> pos) & 1   // 对手？

// 成 mill 检测（一次位与 + 一次比较）
(playerBits & MILL_MASKS[i]) === MILL_MASKS[i]

// 邻居检测
NEIGHBOR_MASKS[pos] & emptyBits

// 遍历所有己方棋子
while (bits) { const pos = ctz(bits); ... bits &= bits - 1; }

// 统计棋子数
popcount(own & MILL_MASKS[i])  // 该 mill 线上有几颗己方子
```

### 三次重复检测

零 hash 计算。双 `Float64Array(32)` 环形缓冲区直接存储 `own`/`opp` 原始值：

```js
// 推入
posOwn[writeIdx & 31] = own;
posOpp[writeIdx & 31] = opp;

// 检测：遍历缓冲区，比较 (own, opp) 出现 ≥3 次 → 判和
```

`Float64Array` 连续内存，不触发 GC，适合深度搜索的高频调用。

## AI 引擎

### Web Worker 架构

搜索在独立线程中执行，不阻塞 UI：

```
game.js → ai.js → postMessage({ fen, player, depth, timeLimit })
                        ↓
              searcher.worker.js
              importScripts('engine.js', 'evaluator.js', 'searcher.js')
              Engine.fromFen(fen) → Searcher.search() → postMessage(result)
                        ↓
              ai.js ← 温度加权随机选择 → 返回走法
```

FEN 序列化采用 own/opp 双整数 + 十六进制元数据的紧凑编码。

### 搜索算法

- **Minimax + Alpha-Beta 剪枝**：标准博弈树搜索
- **迭代加深**：深度 1 逐步加深到目标层，每层完成的走法排序复用于下一层
- **时间墙**：默认 5 秒（Debug 模式 20 秒），每 1024 节点检查一次，超时返回上一层最优
- **成磨不消耗深度**：形成磨坊后同一玩家继续吃子，不计入搜索深度（吃子是强制动作）
- **同分洗牌**：每层迭代完成后，同分走法段内 Fisher-Yates 打乱，避免搜索路径固化
- **搜索无拷贝**：搜索引擎直接操作 Engine 单例状态，`makeMove`/`undoMove` 原地修改，零深拷贝开销

### 难度配置

| 难度 | 搜索深度 | 温度 | Top-K | 典型用时 |
|------|---------|------|-------|---------|
| 菜鸟 | 1-2     | 1.0  | 5     | ~2ms    |
| 老手 | 2-3     | 0.8  | 4     | ~34ms   |
| 大师 | 3-5     | 0~0.25 | 2  | ~319ms  |
| 恶魔 | 5-8     | 0    | 1     | ~5s     |

大师模式按阶段调整：放置深度 3 / 走子深度 4 / 飞行深度 5。恶魔模式在 Debug 解锁后可用，完全确定性（温度 0，TopK 1）。

### 评估体系（evaluator.js）

纯函数 `(depth, ctx) → score`，正分表示 AI 优势。全部使用 Bitboard 位运算，无 board[] 数组访问。

**终局分数**：
- 胜利：`+10000 + (depth+1) × 500`（深度越大分数越高，偏好更快的胜利）
- 失败：`-10000 - (depth+1) × 500`（延迟失败）
- 平局：0

**启发式特征**（均乘以 `depth+1` 深度加权）：

| 特征 | 权重 | 说明 |
|------|------|------|
| nearMill | 10 | 即将成磨坊（2 子 + 1 空位，且可达） |
| hardNearMill | 20 | 对手无法拦截的即将成磨坊 |
| rollingFork | 40 | 滚动叉：成磨后自动形成新的 2+1 威胁 |
| hardRollingFork | 80 | 对手无法拦截的滚动叉 |
| 机动性 | 150 × 0.5^(n-1) | 可达空位数，半衰递减（0→1 极重要，5→6 可忽略） |
| 吃子价值 | 150~200 | 对手 ≥4 子时 150，飞行转折期 200 |

## 毒舌弹幕系统（taunt.js）

替代旧 narrator.js 的三层标签体系，采用规则/台词分离架构。

### 架构

```
buildContext(state, move, score)  →  上下文对象（阶段/棋子/磨坊/机动性/分数/重复次数）
        ↓
RULES[]  →  when(ctx)  →  收集命中 ID  →  加权随机选一个
        ↓
LINES[id]  →  随机选一行台词  →  返回
```

- **规则层**（RULES）：纯谓词匹配，只返回 ID，不含台词
- **台词层**（LINES）：静态查找表，ID → string[]，四语混合
- **匹配引擎**：加权随机，兜底权重 1，阶段权重 15-25，特殊事件权重 100

### ID 编码

高位 0=走前，1=走后；低位与阶段谓词一一对应：

```
走前 (0x)：00-05 阶段 / 06 兜底 / 07 déjà vu
走后 (1x)：10-15 阶段 / 16 兜底 / 17 吃子 / 1A-1I 局面
```

### 谓词体系

| 类别 | 谓词 | 说明 |
|------|------|------|
| 阶段 | placement / moving / aiFlying / oppFlying / ai4 / opp4 | 6 个游戏阶段 |
| 分数段 | scoreWinning / scoreAhead / scoreEven / scoreBehind / scoreLosing | 5 级分数区间 |
| 磨坊威胁 | oppThreatened / aiThreatened / oppHasHRF / aiHasHRF | 滚动叉/硬滚动叉 |
| 走法 | captured | 吃子（成磨后必然吃子） |

### 台词库

四语混合（中文 / 英语 / 希腊语 / 法语），共 ~280 条台词，覆盖 25 条规则。Debug 模式下控制台输出匹配过程：

```
[Taunt] { 1E:100 ; 1F:25 ; 16:10 } → [1E] → 我裂开了
```

## FEN 序列化格式

MILL-FEN 是一个 JSON 字符串：

```json
{"own":12345,"opp":67890,"meta":"0x0c815"}
```

### 棋盘编码（双整数）

直接存储两个 24 位位掩码：
- `own`：AI 棋子位掩码（bit i = 1 → AI 在位置 i）
- `opp`：对手棋子位掩码

零编解码开销，`fromFen` 直接赋值。

### 元数据编码（十六进制）

5 位十六进制数，每位一个字段：

```
对手手牌 | 对手已失 | AI手牌 | AI已失 | 当前玩家+成磨标志
```

在盘数通过 `9 - 手牌 - 已失` 推算，无需单独存储。`fromFen` 入口校验棋子数不溢出、玩家值合法、own 与 opp 无重叠。

## UI 设计

### SVG 棋盘

- viewBox 600×600，24 交点通过 7×7 网格坐标映射
- 五层 SVG 结构：点标记 → 高亮 → 点击区域 → 棋子 → 调试编号
- 三层嵌套矩形 + 四条连接线，圆角棋盘

### 动画

- **放置**：棋子从顶部滑入目标位置（250ms）
- **走子/飞行**：源位置隐藏，动画棋子滑向目标（250ms）
- **吃子**：3 次闪烁 + 缩小消失（600ms）
- **AI 思考**：状态栏棋子波浪式呼吸灯
- **弹幕**：右→左滚动，随机位置/速度（8-12 秒）
- **气泡**：从下方淡入，上限 20 条自动滚动

### 响应式布局

- **竖屏**：棋盘居中，状态栏下方，弹幕叠加在棋盘上
- **横屏**（≥769px）：左侧状态栏（22%） + 中央棋盘 + 右侧气泡侧栏
- **小屏**（≤360px）：缩小字体和棋子点

### 六套主题

| 主题 | 背景 | 棋盘 | 风格 |
|------|------|------|------|
| 荒野余晖 | 大地色系 | 做旧质感 | 复古荒野 |
| 雾灰石板 | #1f2226 | 石板灰 | 冷灰暗色 |
| 晨光暖灰 | #f0efec | 暖灰白 | 温暖明亮 |
| 马卡龙 | #f2f5f8 | 薄荷绿 | 柔和圆角 |
| 霓虹幻影 | #0b0c10 | 霓虹绿 | 荧光发光 |
| 暗夜深空 | #1a1a2e | 暖木色 | 经典深色 |

## PWA 支持

- **Service Worker**：缓存优先策略，预缓存全部资源
- **版本化缓存**：`CACHE_NAME` 版本号递增，更新时自动清除旧缓存
- **离线可用**：首次加载后，断网也能完整运行
- **开发友好**：localhost 请求自动绕过缓存，改代码即时生效

## 测试

```bash
# 单元测试
node test/test_engine.js       # 引擎测试（59 例）
node test/test_evaluator.js    # 评估器测试（30 例）

# 单场对战
node test/battle.js Normal Master 1

# 循环赛（全级别组合，24 场）
bash test/run_battles.sh

# 对战日志分析
node test/analyze.js
```

测试脚本通过 Node.js VM 沙箱加载浏览器 IIFE 模块，同一源码同时支持浏览器和 Node.js 运行。

## 技术细节

- **零依赖**：纯 Vanilla JS，无构建步骤，无 CDN
- **棋盘表示**：双 Uint32 位掩码（`own` / `opp`），24 位对应 24 个交点
- **棋盘拓扑**：预计算位掩码表（16 条 mill 线 + 24 个邻居 + mill-without 辅助表）
- **走法生成**：位扫描遍历棋子/空位（`ctz` + `bits &= bits - 1`），无 24 次循环
- **成磨检测**：`(bits & MILL_MASKS[i]) === MILL_MASKS[i]`，一次位与 + 一次比较
- **机动性计算**：`popcount(NEIGHBOR_MASKS[pos] & emptyBits)`，PLACEMENT/FLYING 阶段直接 `popcount(empty)`
- **三次重复检测**：双 Float64Array 环形缓冲区直接存储 own/opp 原始值，零 hash 计算
- **搜索无拷贝**：搜索引擎直接操作 Engine 单例状态，`makeMove`/`undoMove` 原地修改，零深拷贝开销
- **GC 安全**：环形缓冲区为连续内存（Float64Array），不触发垃圾回收

## 快速开始

```bash
git clone <repo-url>
cd nine-mens-morris-ai
start index.html    # Windows
open index.html     # macOS
xdg-open index.html # Linux
```

零依赖，无构建步骤。浏览器打开即玩。

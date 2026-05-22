# GameUI 架构文档

Nine Men's Morris 前端 UI 层，由三个文件组成：`index.html`（结构）、`style.css`（样式）、`game.js`（逻辑）。

---

## 1. 整体架构

```
index.html          style.css            game.js
┌──────────┐       ┌──────────┐        ┌──────────────┐
│ DOM 结构  │◄──────│ 响应式布局 │       │  Game (IIFE)  │
│ SVG 棋盘  │       │ 棋子样式  │       │              │
│ SVG 滤镜  │       │ 动画定义  │       │  依赖全局：   │
│ 弹幕/气泡 │       │ 主题变量  │       │  Engine      │
│ 弹窗     │       └──────────┘        │  AI         │
└──────────┘                           │  Narrator   │
     ▲                                  │  Strategy   │
     │ DOM API                          └──────────────┘
     └──────────────────────────────────────┘
```

**脚本加载顺序**（`index.html` 底部）：
`engine.js` → `strategy.js` → `ai.js` → `narrator.js` → `game.js`

每个模块都是 IIFE 挂载到全局的单例（`Engine`, `Strategy`, `AI`, `Narrator`, `Game`），通过全局变量互相引用。

---

## 2. index.html — 页面结构

### 2.1 布局分区

```
#app (flex 容器)
├── #header              标题栏 + AI 思考指示器
├── #board-area          棋盘 SVG + 弹幕层
│   ├── #board           SVG 600×600 viewBox
│   └── #danmaku-layer   竖屏弹幕覆盖层
├── #status-panel        状态面板（棋子统计 + 阶段 + 设置）
├── #bubble-area         横屏 AI 气泡区
└── #game-result-modal   游戏结果弹窗
```

### 2.2 SVG 棋盘分层

棋盘 SVG 内部按渲染顺序分层（后绘制在上层）：

| 层 ID | 内容 | 动态/静态 |
|-------|------|----------|
| `board-border-layer` | 棋盘底座边框（三层矩形 + 立体滤镜） | 静态 |
| `board-lines` | 三个嵌套方框 + 四条连接线 | 静态 |
| `board-dots` | 24 个交点黑色小圆点 | 静态，`initBoard()` 创建 |
| `board-highlights` | 合法移动目标高亮圆 | 动态，`renderHighlights()` |
| `board-positions` | 24 个透明交互圆（点击热区） | 静态，`initBoard()` 创建 |
| `board-pieces` | 棋子圆 + CSS 类控制状态 | 动态，`renderBoard()` |
| `board-debug` | 位置编号文字（默认隐藏） | 静态，双击中心切换 |

### 2.3 SVG 滤镜

| 滤镜 ID | 用途 | 引用位置 |
|---------|------|---------|
| `#inset-shadow` | 凹陷内阴影（交互 hover + 高亮） | CSS `.board-position:hover`, `.highlight-move` |
| `#board-border` | 棋盘边框立体感（投影 + 高光 + 暗边） | SVG `#board-border-layer` |

### 2.4 DOM 元素清单

**状态面板：**
- `#label-opponent` / `#label-ai` — 玩家标签（"玩家" / 难度名）
- `#dots-opponent` / `#dots-ai` — 9 个圆点表示棋子状态
- `#phase-display` — 当前阶段（放置/走子/飞行/吃子）
- `#message-display` — 提示信息
- `#btn-difficulty` / `#btn-first-player` — 循环切换按钮
- `#btn-new-game` — 新游戏

**弹幕 / 气泡：**
- `#danmaku-layer` — 竖屏弹幕容器
- `#bubble-list` — 横屏气泡列表

**弹窗：**
- `#game-result-modal` — 结果弹窗（`.hidden` 控制显隐）
- `#result-title` / `#result-stats` — 标题和统计数据
- `.modal-buttons` — 按钮容器（flex 布局）
- `#btn-result-new-game` — 再来一局
- `#btn-result-copy` — 复制记录（仅 Debug 模式可见）

---

## 3. style.css — 样式系统

### 3.1 CSS 变量（:root）

**主题色：**
| 变量 | 值 | 用途 |
|------|-----|------|
| `--color-bg` | `#1a1a2e` | 页面背景 |
| `--color-surface` | `#16213e` | 面板背景 |
| `--color-white` | `#f0f0f0` | 白棋 |
| `--color-black` | `#2d2d2d` | 黑棋 |
| `--color-accent` | `#4fc3f7` | 强调色（选中、AI 思考） |
| `--color-text` | `#e0e0e0` | 主文字 |
| `--color-text-dim` | `#888` | 次要文字 |

**棋子阴影色板：**
| 变量 | 值 | 含义 |
|------|-----|------|
| `--shadow-warm` | `rgba(40,30,20,0.3)` | 暖褐外阴影 |
| `--shadow-black` | `rgba(0,0,0,0.45)` | 黑子外阴影 |
| `--highlight-white` | `rgba(255,255,255,0.9)` | 白子内高光（左上） |
| `--highlight-soft` | `rgba(255,255,255,0.35)` | 黑子内高光（左上，较弱） |
| `--shadow-ambient` | `rgba(0,0,0,0.15)` | 环境暗面（右下） |

**尺寸：**
| 变量 | 值 | 用途 |
|------|-----|------|
| `--radius` | `8px` | 通用圆角 |
| `--header-h` | `48px` | 标题栏高度 |

### 3.2 棋子样式层次

```
.piece                 基类：r=22, pointer-events:none, transition
├── .piece-white       白子：外阴影 → 内高光(左上) → 暗面(右下)
├── .piece-black       黑子：外阴影 → 内高光(左上，更强对比)
├── .piece.selected    选中：白子基础 + 蓝色发光
├── .piece.capture     可吃：白子基础 + 红色发光 + 红色边框
└── .piece.captured    被吃动画：闪烁 → 缩小消失 (0.6s)
```

**阴影结构说明：** 每个棋子 filter 由多层 `drop-shadow` 叠加：
1. 外阴影（右下偏移）— 产生立体浮起感
2. 内高光（左上偏移）— 模拟曲面迎光面
3. 暗面（右下偏移，仅白子）— 模拟曲面背光面
4. 状态发光（选中蓝 / 吃子红）— 叠加在最外层

### 3.3 响应式断点

| 条件 | 布局 | AI 台词 |
|------|------|---------|
| 竖屏（默认） | 上:标题 → 中:棋盘 → 下:状态面板 | 弹幕（横向滚动） |
| 横屏 `≥769px` | 左:状态面板 → 中:棋盘+标题 → 右:气泡区 | 气泡（纵向堆叠） |
| 小屏 `≤360px` | 缩小标题栏/圆点/按钮字号 | — |

横屏布局通过 `@media (orientation: landscape) and (min-width: 769px)` 切换：
- `#app` 从 `flex-direction: column` → `row`
- `#status-panel` 从底部横条 → 左侧竖栏（`order: -1`）
- `#bubble-area` 从 `display: none` → 右侧栏
- `#header` 从正常流 → `position: absolute` 叠加在棋盘上方

---

## 4. game.js — UI 控制器

### 4.1 模块结构

```js
const Game = (() => {
    // 私有状态和函数
    return { init };  // 唯一公开接口
})();

document.addEventListener('DOMContentLoaded', Game.init);
```

依赖：`Engine`（E）、`AI`、`Narrator` 作为全局变量引用。

### 4.2 棋盘坐标系统

24 个棋盘位置映射到 7×7 网格坐标，再映射到 SVG 坐标：

```
位置 0-23  ──GRID[]──►  网格 (col, row)  ──posToSvg()──►  SVG (x, y)
                          0-6, 0-6                        600×600 viewBox
```

**网格布局：**
```
  0   1   2   3   4   5   6
0 ●───────────────●───────────────●    位置 0,1,2
  │               │               │
1 │   ●───────────●───────────●   │    位置 3,4,5
  │   │           │           │   │
2 │   │   ●───────●───────●   │   │    位置 6,7,8
  │   │   │               │   │   │
3 ●───●───●               ●───●───●    位置 9,10,11  ×  12,13,14
  │   │   │               │   │   │
4 │   │   ●───────●───────●   │   │    位置 15,16,17
  │   │           │           │   │
5 │   ●───────────●───────────●   │    位置 18,19,20
  │               │               │
6 ●───────────────●───────────────●    位置 21,22,23
```

**坐标常量：**
- `MARGIN = 50` — 棋盘边距
- `BOARD_PX = 500` — 棋盘区域尺寸
- `CELL = 500/6 ≈ 83.33` — 网格间距

### 4.3 游戏状态变量

| 变量 | 类型 | 含义 |
|------|------|------|
| `selectedPos` | `number\|null` | 当前选中的玩家棋子位置 |
| `legalTargets` | `number[]` | 选中棋子的合法目标位置列表 |
| `currentLegalPlayer` | `number\|null` | 合法目标对应的玩家（用于区分吃子/移动） |
| `playerMoves` | `Move[]` | 当前玩家所有合法走法 |
| `isAIThinking` | `boolean` | AI 是否正在思考（阻断玩家点击） |
| `debugMode` | `boolean` | Debug 模式（显示位置编号 + 复制记录按钮） |
| `settings` | `{difficulty, firstPlayer}` | 用户设置 |

### 4.4 核心函数一览

| 函数 | 职责 |
|------|------|
| `initBoard()` | 创建 24 个交点标记 + 24 个交互热区 |
| `renderBoard()` | 清空并重建棋子层，应用 selected/capture 类 |
| `renderHighlights()` | 绘制空位移动高亮（吃子由 `.capture` 类处理） |
| `resetSelection()` | 重置选中状态（selectedPos / legalTargets / currentLegalPlayer） |
| `selectPiece(pos)` | 选中棋子，计算合法目标 |
| `deselectPiece()` | 取消选中并重绘 |
| `onPositionClick(pos)` | 点击入口，分派到 placement / capture / move |
| `handlePlacementClick(pos)` | 放置阶段：查找匹配走法并执行 |
| `handleCaptureClick(pos)` | 吃子阶段：查找匹配走法并执行 |
| `handleMoveClick(pos)` | 走子阶段：选子 / 切换 / 移动 / 取消 |
| `animateAndExecute(move)` | 播放动画 → Engine.makeMove() → renderBoard() |
| `executePlayerMove(move)` | 玩家走法主流程（动画 + 状态 + 回合切换） |
| `handleAICapture()` | AI 吃子：静态评估选最佳吃子目标 |
| `doAITurn()` | AI 回合主流程（思考 → 走子 → 台词 → 吃子 → 回到玩家） |
| `updateStatus()` | 刷新棋子圆点 + 阶段显示 |
| `renderDots(id, data, color)` | 渲染 9 个圆点（在手/在盘/已失） |
| `updatePhaseDisplay()` | 更新阶段文字（使用难度标签而非 "AI"） |
| `exportGameRecord()` | 生成可读文本对战记录 |
| `copyRecord()` | 复制记录到剪贴板 + 按钮反馈 |
| `showGameResult()` | 弹出结果弹窗（含 Debug 模式复制按钮） |
| `showAILine(text)` | 根据屏幕方向选择弹幕或气泡 |
| `showDanmaku(text)` | 竖屏弹幕（随机位置，8-12 秒滚动） |
| `showBubble(text)` | 横屏气泡（追加到底部，最多 20 条） |
| `applySettings()` | 应用设置到 UI（按钮文字 + 标签 + 先手排序） |
| `newGame(overrides)` | 重置引擎 + UI，开始新游戏 |
| `toggleDebug()` | 切换 Debug 模式（位置编号显隐） |

### 4.5 核心流程

#### 4.5.1 初始化流程

```
DOMContentLoaded
  └─► Game.init()
        ├─► initBoard()          创建 24 个交点 + 24 个交互热区
        ├─► loadSettings()       从 localStorage 读取
        └─► newGame()            开始新游戏
              ├─► applySettings()    更新 UI 标签
              ├─► AI.setPerformanceMode()
              ├─► Engine.init()
              ├─► renderBoard()
              ├─► updateStatus()
              └─► [若 AI 先手] doAITurn()
```

#### 4.5.2 玩家回合流程

```
玩家点击棋盘位置
  └─► onPositionClick(pos)
        ├─ guard: isAIThinking? gameOver? 不是玩家回合?
        │
        ├─ millMove?     → handleCaptureClick(pos)
        ├─ 手中有子?     → handlePlacementClick(pos)
        └─ 否则          → handleMoveClick(pos)
                             ├─ 已选子 + 点合法目标 → executePlayerMove()
                             ├─ 已选子 + 点自己其他子 → selectPiece() 切换
                             ├─ 已选子 + 点无效 → deselectPiece()
                             └─ 未选子 + 点自己子 → selectPiece()
```

#### 4.5.3 走法执行流程

```
executePlayerMove(move)
  ├─► animateAndExecute(move)     播放动画 + Engine.makeMove()
  ├─► resetSelection()            清除选中状态
  ├─► updateStatus()              更新面板
  │
  ├─ gameOver?                    → showGameResult()
  ├─ millMove (玩家需吃子)?       → 等待玩家点击吃子目标
  └─ 否则                         → doAITurn()
```

#### 4.5.4 AI 回合流程

```
doAITurn()
  ├─► setThinking(true)
  ├─► AI.selectBestMove()         获取最佳走法
  ├─► animateAndExecute(move)     播放动画
  ├─► Narrator.getLine() → showAILine()   AI 台词
  │
  ├─ millMove (AI 需吃子)?       → handleAICapture()
  │                                 ├─ 静态评估所有吃子选项
  │                                 └─ 选最高分执行
  │
  ├─ gameOver?                    → showGameResult()
  └─ 回到玩家回合                  → 生成玩家走法 + 更新提示
```

#### 4.5.5 动画系统

`animateAndExecute(move)` 根据走法类型播放不同动画：

| 走法类型 | 动画 | 时长 |
|---------|------|------|
| `move` / `fly` | 棋子从起点滑动到终点（CSS transition on cx/cy） | 300ms |
| `remove` | 目标棋子闪烁 + 缩小消失（`capture-flash` keyframe） | 600ms |
| `place` | 无动画，直接渲染 | — |

动画结束后调用 `Engine.makeMove()` 更新引擎状态，再 `renderBoard()` 刷新画面。

### 4.6 设置系统

| 设置项 | 键 | 值 | 存储 |
|-------|-----|-----|------|
| 难度 | `difficulty` | `Eco` / `Normal` / `Master` | `localStorage('nmm-settings')` |
| 先手 | `firstPlayer` | `opponent` / `ai` | 同上 |

按钮点击循环切换选项，变更后立即 `newGame()` 重新开始。

**难度映射：**
- `Eco` → 菜鸟 (depth 1)
- `Normal` → 老手 (depth 3)
- `Master` → 大师 (depth 4)

### 4.7 Debug 模式

双击棋盘中心区域（距圆心 < 24px）切换 Debug 模式：

- 位置编号文字（红色，24 个位置）显示/隐藏
- 结果弹窗中「复制记录」按钮显示/隐藏

`exportGameRecord()` 生成可读文本格式的对战记录，包含：设置信息、每步走法（用「玩家」/难度标签）、成行标记、最终统计。通过 `navigator.clipboard.writeText()` 复制到剪贴板。

### 4.8 AI 台词呈现

根据屏幕方向选择不同呈现方式：

| 方向 | 组件 | 行为 |
|------|------|------|
| 竖屏 | 弹幕 `#danmaku-layer` | 随机纵向位置，从右向左滚动 8-12 秒后移除 |
| 横屏 | 气泡 `#bubble-list` | 追加到底部，最多保留 20 条，自动滚到底 |

判断函数：`isLandscape()` → `window.innerWidth > innerHeight && innerWidth >= 769`

### 4.9 状态面板

`updateStatus()` 调用链：

```
updateStatus()
  ├─► renderDots('dots-opponent', playerData, 'white')
  ├─► renderDots('dots-ai', playerData, 'black')
  └─► updatePhaseDisplay()
```

**棋子圆点状态：**
- `.hand` + `.dot-white/black` — 在手（实心）
- `.board` + `.dot-white/black` — 在盘（空心边框）
- `.lost` — 已失（灰色虚线边框）

**阶段判断优先级：** gameOver > millMove（吃子） > piecesOnHand > 0（放置） > piecesOnBoard ≤ 3（飞行） > 走子

所有显示 AI 名称的地方（阶段显示、结果弹窗、对战记录）统一使用难度标签（菜鸟/老手/大师），不硬编码 "AI"。

---

## 5. 与引擎的接口

`game.js` 通过以下 API 与 `Engine` 交互：

| API | 用途 |
|-----|------|
| `E.init({firstPlayer})` | 初始化/重置游戏 |
| `E.getBoard()` | 获取 24 位棋盘数组 |
| `E.getRawState()` | 获取原始状态引用 |
| `E.generateLegalMoves(player)` | 生成合法走法列表 |
| `E.makeMove(move)` | 执行走法 |
| `E.undoMove()` | 撤销走法（AI 评估用） |
| `E.isGameOver()` | 检查游戏结束 |
| `E.TYPE_OPPONENT` / `E.TYPE_AI` | 玩家常量 |

**走法对象结构：**
```js
{
    player: 1|2,        // 玩家
    type: 'place'|'move'|'fly'|'remove',
    from: number,       // 起点（place 时为 -1）
    to: number,         // 终点（remove 时为 -1）
    remove: number      // 被吃位置（仅 remove 类型）
}
```

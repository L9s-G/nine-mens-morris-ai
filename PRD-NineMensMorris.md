### 一、整体架构设计

我们将把引擎分成清晰的模块：

- **`Engine`**：核心游戏逻辑（状态管理、规则执行、走法生成）
- **`AIDialog`**：AI 决策层（Minimax + Alpha-Beta + 评估函数）
- **`Interaction`**：UI 层（保持不变或微调）

---

### 二、Engine 核心设计（最重要）

#### 1. 状态（State）设计

```js
const GameState = {
    board: new Array(24).fill(null),     // 0~23, null=空, TYPE_HUMAN / TYPE_AI
    turn: TYPE_HUMAN,                    // 当前轮到谁
    millMove: false,                     // 是否处于吃子阶段
    selected: null,                      // 当前选中的棋子（移动阶段）
    playerHuman: {
        piecesOnHand: 9,
        piecesOnBoard: 0,
        piecesCaptured: 0
    },
    playerAI: {
        piecesOnHand: 9,
        piecesOnBoard: 0,
        piecesCaptured: 0
    },
    moveHistory: [],                     // 用于悔棋和日志
    gameOver: false,
    winner: null
};
```

#### 2. Engine 需要对外提供的核心接口

我推荐以下**精炼且完备**的接口：

```js
const Engine = {
    // 初始化
    init(),
    reset(),
    getState(),                    // 返回当前状态（浅拷贝或只读视图）

    // 走法相关
    generateLegalMoves(player),    // 返回所有合法走法 [{from, to, remove?}]
    isLegalMove(move),             // 验证单步走法

    // 执行与回退（AI 搜索必须）
    makeMove(move),                // 执行一步（返回是否形成 mill）
    undoMove(),                    // 撤销最后一步（支持搜索中的回退）
    
    // 规则辅助
    isMill(pos, board?),           // 检查某位置是否形成 Mill
    getRemovablePieces(player),    // 获取可吃的对方棋子
    hasAnyMoves(player),           // 是否还有合法走法
    checkWinner(),                 // 检查游戏是否结束

    // 阶段判断
    getPhase(player),              // 'placement' | 'moving' | 'flying'

    // 工具函数
    areNeighbors(a, b),
    countMills(player),
    getPlayer(playerType),
    
    // AI 专用（高效 make/unmake）
    _aiMakeMove(from, to, remove?),   // 内部快速版本，不触发动画
    _aiUndoMove(),                    // 内部快速回退
};
```

---

### 三、走法（Move）统一表示

这是重构成功的关键：

```js
// 统一 Move 对象格式
{
    from: number,      // -1 表示放置阶段
    to: number,        // 目标位置
    remove: number | null,   // 吃子位置（形成 Mill 后）
    type: 'place' | 'move' | 'capture' | 'flying'
}
```

---

### 四、关键函数详细说明

1. **`generateLegalMoves(player)`** —— 核心中的核心
2. **`makeMove(move)`** / **`undoMove()`** —— 支持搜索的关键
3. **`evaluate(state)`** —— 分阶段强评估函数
4. **`alphabeta(...)`** —— 标准 Alpha-Beta

---

### 下一步行动计划

我建议按以下顺序开发：

**阶段 1（今天就可以完成）**：
- 定义好 `GameState` 结构
- 实现 `NEIGHBORS` + `MILLS` 常量
- 实现 `generateLegalMoves(player)`
- 实现 `makeMove` / `undoMove`

**阶段 2**：
- 实现强评估函数
- 实现标准 Alpha-Beta

**阶段 3**：
- 整合到 AI 执行流程 + Web Worker（可选防卡）

---

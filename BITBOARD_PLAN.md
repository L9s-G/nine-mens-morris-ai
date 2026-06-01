# 三进制 → 双二进制 (Bitboard) 全量改造

## 设计原则
- **全新改造，不兼容旧格式** — 当新游戏设计
- **getBoard() 暂保留** — 从 own/opp 重建 24 元素数组供 game.js，解耦
- **双棋盘 + 双缓冲** — own/opp 各一个 Float64Array 环形缓冲区，直接比较，零计算
- **GC 安全** — 环形缓冲区用 `Float64Array`，连续内存不触发 GC

---

## 一、核心数据结构

```js
// state 对象
{
    own: 0,          // Uint32: AI 棋子位掩码（bit i = 1 → AI 在位置 i）
    opp: 0,          // Uint32: 对手棋子位掩码
    currentPlayer: TYPE_AI,
    millMove: false,
    playerOpponent: { piecesOnHand, piecesOnBoard, piecesLost },
    playerAI: { ... },
    moveHistory: [],
    gameOver: false,
    winner: null,
    posOwn: new Float64Array(32),  // 环形缓冲区：直接存 own 原始值
    posOpp: new Float64Array(32),  // 环形缓冲区：直接存 opp 原始值
    writeIdx: 0,
}
```

### 预计算表（engine.js 顶部，常量）

```js
// 16 条 mill 线的位掩码
const MILL_MASKS = [
    0b111,                  // [0,1,2]
    0b111 << 3,             // [3,4,5]
    0b111 << 6,             // [6,7,8]
    0b111 << 9,             // [9,10,11]
    0b111 << 12,            // [12,13,14]
    0b111 << 15,            // [15,16,17]
    0b111 << 18,            // [18,19,20]
    0b111 << 21,            // [21,22,23]
    (1<<0)|(1<<9)|(1<<21),  // [0,9,21]
    (1<<3)|(1<<10)|(1<<18), // [3,10,18]
    (1<<6)|(1<<11)|(1<<15), // [6,11,15]
    (1<<8)|(1<<12)|(1<<17), // [8,12,17]
    (1<<5)|(1<<13)|(1<<20), // [5,13,20]
    (1<<2)|(1<<14)|(1<<23), // [2,14,23]
    (1<<1)|(1<<4)|(1<<7),   // [1,4,7]
    (1<<16)|(1<<19)|(1<<22),// [16,19,22]
];

// 24 个位置的邻居位掩码
const NEIGHBOR_MASKS = [
    (1<<1)|(1<<9),                // 0
    (1<<0)|(1<<2)|(1<<4),         // 1
    (1<<1)|(1<<14),               // 2
    (1<<4)|(1<<10),               // 3
    (1<<1)|(1<<3)|(1<<5)|(1<<7),  // 4
    (1<<4)|(1<<13),               // 5
    (1<<7)|(1<<11),               // 6
    (1<<4)|(1<<6)|(1<<8),         // 7
    (1<<7)|(1<<12),               // 8
    (1<<0)|(1<<10)|(1<<21),       // 9
    (1<<3)|(1<<9)|(1<<11)|(1<<18),// 10
    (1<<6)|(1<<10)|(1<<15),       // 11
    (1<<8)|(1<<13)|(1<<17),       // 12
    (1<<5)|(1<<12)|(1<<14)|(1<<20),// 13
    (1<<2)|(1<<13)|(1<<23),       // 14
    (1<<11)|(1<<16),              // 15
    (1<<15)|(1<<17)|(1<<19),      // 16
    (1<<12)|(1<<16),              // 17
    (1<<10)|(1<<19),              // 18
    (1<<16)|(1<<18)|(1<<20)|(1<<22),// 19
    (1<<13)|(1<<19),              // 20
    (1<<9)|(1<<22),               // 21
    (1<<19)|(1<<21)|(1<<23),      // 22
    (1<<14)|(1<<22),              // 23
];

// 每个位置属于哪两条 mill 线（保留！isInMill/wouldFormMill 需要知道查哪 2 条线，不能遍历 16 条）
const POSITION_MILLS = ...; // 同现有逻辑，从"数组下标"变为"位掩码索引"

// 去掉 pos 后的 mill 两子掩码：MILL_WITHOUT[pos][millIdx]
// 用于 wouldFormMill：(playerBits & MILL_WITHOUT[pos][i]) === MILL_WITHOUT[pos][i]
const MILL_WITHOUT = Array.from({length:24}, () => []);
// 初始化：对每个 pos，遍历 POSITION_MILLS[pos]，计算 millMask & ~(1<<pos)
```

---

## 二、引擎 API（纯 bitboard，getBoard() 暂保留兼容层）

```js
// 查询
getOwn()           → state.own
getOpp()           → state.opp
getEmptyBits()     → ~(own | opp) & 0xFFFFFF
isEmpty(pos)       → ((own|opp) >> pos) & 1) === 0
getOwner(pos)      → ((own>>pos)&1) ? TYPE_AI : ((opp>>pos)&1) ? TYPE_OPPONENT : EMPTY
isInMill(pos)      → bitboard 版（见下文）
wouldFormMill(to, player) → bitboard 版
getBoard()         → 从 own/opp 重建 24 元素数组（兼容 game.js）

// 走法
generateLegalMoves(player) → bitboard 版
makeMove(move)     → 位运算更新 own/opp，推入重复检测缓冲区
undoMove()         → 位运算逆操作

// 序列化
toFen()            → { own, opp, meta: "0x..." }  // 直接存两个整数
fromFen(fen)       → 读 own/opp 恢复（只处理新格式）

// 重复检测（零 hash 计算）
pushState()        → 直接写 own/opp 到 Float64Array 环形缓冲区
checkRepetition()  → 遍历缓冲区，比较 own+opp 两值
```

---

## 三、关键函数改造

### isInMill(pos)
```js
function isInMill(pos) {
    const bits = (own >> pos) & 1 ? own : opp;
    const [m0, m1] = POSITION_MILLS[pos];
    return (bits & MILL_MASKS[m0]) === MILL_MASKS[m0]
        || (bits & MILL_MASKS[m1]) === MILL_MASKS[m1];
}
```

### wouldFormMill(to, player)
```js
function wouldFormMill(to, player) {
    const bits = player === TYPE_AI ? own : opp;
    const [m0, m1] = POSITION_MILLS[to];
    return (bits & MILL_WITHOUT[to][0]) === MILL_WITHOUT[to][0]
        || (bits & MILL_WITHOUT[to][1]) === MILL_WITHOUT[to][1];
}
```

### makeMove（Place AI 为例）
```js
// Place
own |= (1 << to); own >>>= 0;

// Move
own ^= (1 << from) | (1 << to); own >>>= 0;

// Remove
opp &= ~(1 << remove); opp >>>= 0;

// 重复检测：直接推入原始值，零计算
pushState(own, opp);  // 写入 Float64Array 环形缓冲区

// undoMove: 存 own/opp 的旧值到 moveHistory，撤销时恢复
// 或者：moveHistory 记录 delta，undo 用反向位运算
```

### generateLegalMoves — 位扫描
```js
function generateLegalMoves(player) {
    const playerBits = player === TYPE_AI ? own : opp;
    const emptyBits = ~(own | opp) & 0xFFFFFF;
    const moves = [];

    if (state.millMove) {
        // 吃子：遍历对手棋子
        let oppBits = player === TYPE_AI ? opp : own;
        while (oppBits) {
            const pos = ctz(oppBits);  // count trailing zeros
            if (!isInMill(pos)) moves.push({ type:'remove', remove:pos });
            oppBits &= oppBits - 1;
        }
        if (!moves.length) {
            // 全在 mill 中，允许吃任何对手子
            oppBits = player === TYPE_AI ? opp : own;
            while (oppBits) { moves.push({ type:'remove', remove: ctz(oppBits) }); oppBits &= oppBits-1; }
        }
        return moves;
    }

    if (getPhase(player) === 'PLACEMENT') {
        let bits = emptyBits;
        while (bits) {
            const to = ctz(bits);
            const move = { type:'place', to, remove:null };
            if (wouldFormMill(to, player)) expandCaptures(move, moves, player);
            else moves.push(move);
            bits &= bits - 1;
        }
    } else {
        let pieces = playerBits;
        while (pieces) {
            const from = ctz(pieces);
            const targets = getPhase(player) === 'FLYING'
                ? emptyBits
                : NEIGHBOR_MASKS[from] & emptyBits;
            let t = targets;
            while (t) {
                const to = ctz(t);
                const move = { type:'move', from, to, remove:null };
                if (wouldFormMill(to, player)) expandCaptures(move, moves, player);
                else moves.push(move);
                t &= t - 1;
            }
            pieces &= pieces - 1;
        }
    }
    // mill-forming moves 排前面
    moves.sort((a,b) => (b.remove!==null) - (a.remove!==null));
    return moves;
}
```

### analyzeMillsBoth — evaluator 核心
```js
function analyzeMillsBoth() {
    const empty = ~(own | opp) & 0xFFFFFF;
    const aiPhase = E.getPhase(TYPE_AI);
    const oppPhase = E.getPhase(TYPE_OPPONENT);

    // 预计算：已完成 mill 的棋子位掩码
    let ownInMill = 0, oppInMill = 0;
    for (let i = 0; i < 16; i++) {
        if ((own & MILL_MASKS[i]) === MILL_MASKS[i]) ownInMill |= MILL_MASKS[i];
        if ((opp & MILL_MASKS[i]) === MILL_MASKS[i]) oppInMill |= MILL_MASKS[i];
    }

    const rAI = { nearMills:0, hardNearMills:0, rollingForks:0, hardRollingForks:0 };
    const rOpp = { nearMills:0, hardNearMills:0, rollingForks:0, hardRollingForks:0 };
    const countedAI = new Set();
    const countedOpp = new Set();

    for (let i = 0; i < 16; i++) {
        const mm = MILL_MASKS[i];
        const ownCnt = popcount(own & mm);
        const oppCnt = popcount(opp & mm);
        const empBits = empty & mm;

        // AI 2+1
        if (ownCnt === 2 && oppCnt === 0 && empBits) {
            const posE = ctz(empBits);
            if (!countedAI.has(posE)) {
                // nearMill: 空位可达？（非 MOVING 或有己方非 mill 邻居）
                const outsideMill = own & ~mm;
                const reachable = aiPhase !== 'MOVING'
                    || (NEIGHBOR_MASKS[posE] & outsideMill) !== 0;
                if (reachable) {
                    countedAI.add(posE);
                    rAI.nearMills++;
                    // hardNearMill
                    if (oppPhase === 'MOVING' && (NEIGHBOR_MASKS[posE] & opp) === 0)
                        rAI.hardNearMills++;
                    // rollingFork: 空位有邻居在已完成 mill 中
                    const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;
                    const inMillN = candidateN & ownInMill;
                    if (inMillN) {
                        rAI.rollingForks++;
                        if (oppPhase === 'MOVING'
                            && (NEIGHBOR_MASKS[posE] & opp) === 0
                            && (NEIGHBOR_MASKS[ctz(inMillN)] & opp) === 0)
                            rAI.hardRollingForks++;
                    }
                }
            }
        }
        // Opp 2+1（对称）
        if (oppCnt === 2 && ownCnt === 0 && empBits) {
            // ... 同理，own ↔ opp
        }
    }
    // placement/flying 修正
    if (oppPhase !== 'MOVING') { rOpp.hardNearMills = Math.max(0, rOpp.nearMills-1); ... }
    if (aiPhase !== 'MOVING') { rAI.hardNearMills = Math.max(0, rAI.nearMills-1); ... }

    return { ai: rAI, opp: rOpp };
}
```

### countMobility — 位版本
```js
function countMobility(player) {
    const empty = ~(own | opp) & 0xFFFFFF;
    if (getPhase(player) !== 'MOVING') return popcount(empty);

    const playerBits = player === TYPE_AI ? own : opp;
    let mob = 0, bits = empty;
    while (bits) {
        const pos = ctz(bits);
        if (NEIGHBOR_MASKS[pos] & playerBits) mob++;
        bits &= bits - 1;
    }
    return mob;
}
```

---

## 四、工具函数

```js
/** Count Trailing Zeros — 取最低位的 1 的位置 */
function ctz(x) {
    // JS 无原生 CTZ，用 Math.clz32
    return 31 - Math.clz32(x & -x);
}

/** Population Count — 统计 1 的个数 */
function popcount(x) {
    // Brian Kernighan's algorithm
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return ((x + (x >> 4) & 0x0F0F0F0F) * 0x01010101) >> 24;
}
```

---

## 五、JS 位运算注意事项（u32 教训）

JavaScript 的 `<<`、`|`、`&`、`>>`、`^` 等位运算符会将操作数转为 **有符号 32 位整数**。

**已知坑：**
- `(1 << 31)` 是 `-2147483648`（负数），不是 2^31
- `(1 << 24) | highBits` 如果 highBits 有 bit 7+ 置位，结果溢出为负
- 所有位运算结果都是有符号 32 位，高位会被截断

**对策：**
- 每次 `|=` / `&=~` / `^=` 后加 `>>>= 0` 转无符号（同现有 `u32()` 函数）
- 需要超过 32 位的值（如 hash）**不用位运算**，用算术：`a * 16777216 + b`
- 比较操作（`===`）不受影响，因为比较的是数值而非位模式
- `own * 16777216 + opp` 最大值 ≈ 2^48，在 JS 安全整数范围（2^53）内，零精度损失

**本项目中的应用：**
- `own`/`opp` 做完位操作后必须 `>>> 0`
- 重复检测不用 hash，直接比较 own/opp 原始值，彻底规避此问题

### 对单元测试的影响

每个涉及位运算的函数都需要测试**高位边界**：

```js
// 测试 own/opp 高位置位后是否仍为正数
assert(own >= 0, 'own must be unsigned after bit ops');
assert(opp >= 0, 'opp must be unsigned after bit ops');

// 测试位置 20-23（高位）的操作
own |= (1 << 23); own >>>= 0;
assert(own === (1 << 23), 'bit 23 set correctly');
assert(own > 0, 'own still positive after high bit set');

// 测试 makeMove/undoMove 在高位位置的往返一致性
makeMove({ type:'place', to:23 });
undoMove();
assert(own === originalOwn, 'undo restores own correctly');
assert(opp === originalOpp, 'undo restores opp correctly');

// 测试 wouldFormMill 在高位 mill 线（如 [21,22,23]）
// 确保 (1<<21)|(1<<22)|(1<<23) 不会溢出为负
```

### 工具函数的边界测试

```js
// ctz 边界
assert(ctz(1) === 0, 'ctz(1)');
assert(ctz(1 << 23) === 23, 'ctz high bit');
assert(ctz(0b1010) === 1, 'ctz non-power-of-2');

// popcount 边界
assert(popcount(0) === 0, 'popcount(0)');
assert(popcount(0xFFFFFF) === 24, 'popcount all 24 bits');
assert(popcount(1 << 23) === 1, 'popcount high bit');

// MILL_MASKS 高位验证
assert(MILL_MASKS[7] === ((1<<21)|(1<<22)|(1<<23)), 'mill [21,22,23]');
assert(MILL_MASKS[7] > 0, 'mill mask high bits not negative');
assert(MILL_MASKS[15] === ((1<<16)|(1<<19)|(1<<22)), 'mill [16,19,22]');
```

---

## 六、改动范围

### engine.js（重写）
- 新增：MILL_MASKS, NEIGHBOR_MASKS, MILL_WITHOUT, ctz, popcount
- 重写：state 结构, isInMill, wouldFormMill, generateLegalMoves, makeMove/undoMove, toFen/fromFen, 重复检测（双缓冲区）
- 保留：getBoard() 兼容层（从 own/opp 重建 24 元素数组）
- 删除：board[], pow3[]

### evaluator.js（重写）
- 重写：isInCompletedMill, analyzeMillsBoth, countMobility, getPieceMobility
- 新增：popcount 依赖（或从 engine 导入）

### 不改动
- game.js — 通过 getBoard() 兼容层解耦
- ai.js, searcher.js, searcher.worker.js（通过 Engine API）
- taunt.js（只读 piece counts）
- index.html, themes.css

---

## 七、验证计划

### 文件约定
- 测试脚本：`test/` 目录下
- 测试日志：`test/logs/` 目录下（已 gitignore）

### Phase 1 — 单元测试（基于当前三进制引擎，改造后作为回归基线）

#### `test/test_engine.js`

```
1. isInMill(board, pos)
   - 空棋盘 → false
   - 单子不成 mill → false
   - 3 子成 mill → true
   - 高位 mill [21,22,23] → true（u32 边界）
   - 位置 0 的两条线：横 [0,1,2] 和竖 [0,9,21]

2. wouldFormMill(board, to, player)
   - 空棋盘落子 → false（另外两子为空）
   - 已有 2 子，落第 3 子 → true
   - 高位位置 23 落子成 mill → true（u32 边界）
   - 对手棋子在线上 → false

3. generateLegalMoves(player)
   - PLACEMENT 阶段：生成 24 个空位的 place moves
   - MOVING 阶段：每个棋子的邻居空位
   - FLYING 阶段：每个棋子可飞任意空位
   - millMove 状态：只生成 remove moves
   - millMove + 全在 mill 中：允许吃任何子
   - mill-forming moves 排前面
   - 成 mill 后展开吃子（每个可吃子一个 move）

4. makeMove / undoMove 往返一致性
   - place → undo → 棋盘恢复
   - move → undo → 棋盘恢复
   - fly → undo → 棋盘恢复
   - remove → undo → 棋盘恢复
   - place + remove（成 mill 吃子）→ undo → 恢复
   - **高位位置 23 的 place/move/remove → undo → 恢复**（u32 边界）
   - 连续 10 步 → 连续 10 次 undo → 恢复
   - 重复检测缓冲区：undo 后缓冲区也恢复

5. 重复检测
   - 同一局面出现 3 次 → gameOver + draw
   - 不同局面 → 无 draw
   - 缓冲区满 32 槽后回绕正确

6. toFen / fromFen
   - 空棋盘 → 序列化 → 反序列化 → 一致
   - 有棋子 → 序列化 → 反序列化 → 一致
   - 高位位置 23 有棋子 → 一致（u32 边界）
   - piece count 校验：onHand + onBoard + lost = 9
```

#### `test/test_evaluator.js`

```
1. isInCompletedMill(board, pos, player)
   - 同 isInMill 但接受显式 player 参数
   - 空位 → false

2. analyzeMillsBoth()
   - 空棋盘 → 所有统计为 0
   - 单方 2+1 → nearMill = 1
   - 2+1 + 空位可达 → nearMill
   - 2+1 + 空位不可达（MOVING 阶段无邻居）→ 不计
   - 2+1 + 对手不可达 → hardNearMill
   - 2+1 + 空位邻居在已完成 mill 中 → rollingFork
   - rollingFork + 对手不可达 posE 和 posN → hardRollingFork
   - placement/flying 阶段修正：hardNearMills = max(0, nearMills-1)
   - **高位 mill 线 [21,22,23] 的 2+1 → 正确检测**（u32 边界）

3. countMobility(player)
   - PLACEMENT：返回空位数
   - FLYING：返回空位数
   - MOVING：返回有己方邻居的空位数
   - 全满棋盘 → 0
   - 单子 → 返回邻居空位数
```

#### 测试运行方式
```bash
node test/test_engine.js      # 输出 pass/fail + 统计
node test/test_evaluator.js   # 输出 pass/fail + 统计
```

日志输出到 `test/logs/`（已 gitignore）。

### Phase 2 — 分步改造
1. 预计算表（MILL_MASKS, NEIGHBOR_MASKS, MILL_WITHOUT, POSITION_MILLS 保留）+ state 结构（own/opp）+ ctz/popcount
2. isInMill / wouldFormMill
3. makeMove / undoMove + 双 Float64Array 环形缓冲区（无 hash 计算）
4. generateLegalMoves
5. toFen / fromFen（新格式，不兼容旧记录）
6. evaluator.js（analyzeMillsBoth, countMobility 等）
7. getBoard() 保留兼容层（从 own/opp 重建 24 元素数组供 game.js 使用）

### 每步验证
- 单元测试全部通过
- `node test/battle.js` 对比旧版 AI 行为
- 吞吐量基准测试（nodes/ms 对比）

### 最终验证
- 24 场 round-robin tournament 对比旧版胜率

---

## 八、预估收益

| 函数 | 旧版 | 新版 | 提升 |
|------|------|------|------|
| isInMill | 6 次 board[] 读 | 2 次位与 | ~2-3x |
| wouldFormMill | 4+ 次读 + 循环 | 2 次位与 | ~3-4x |
| analyzeMillsBoth | ~100 次读 + 多层循环 + 2×Set 分配 | 位与 + popcount + ctz | ~3-5x |
| countMobility (PLACEMENT) | 24 次循环 | 1 次 popcount | ~10x+ |
| countMobility (MOVING) | 24+neighbor 循环 | 遍历空位 + 位与 | ~2-3x |
| generateLegalMoves | 24 次全盘扫描 | 按棋子/空位数迭代 | ~3-5x |
| makeMove | 数组写 + 乘法 hash | 位运算 + 写 Float64Array 缓冲区，零乘法 | ~2x |
| GC 压力 | Set 分配 + Array 创建 | Float64Array 连续内存 | 显著减少 |

**总体吞吐目标**：400-700n/ms → 800-1500n/ms

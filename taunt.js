// ========================================================
// Nine Men's Morris 毒舌弹幕 (Taunt)
// 职责：AI 走前/走后生成吐槽台词
// 架构：上下文构建 → 规则匹配（谓词） → 随机选词
// 外部依赖：Engine, Evaluator
// ========================================================

const Taunt = (() => {
    const E = Engine;
    const EV = Evaluator;

    // ==================== 配置 ====================

    let config = {
        mode: 'offline',   // 'offline' | 'online'
        apiKey: null,
        apiEndpoint: null,
        model: null,
    };

    // ==================== 上下文构建 ====================

    /**
     * 从 Engine 状态构建规则匹配用的上下文对象
     * @param {Object} state - Engine.getStateView()
     * @param {Object|null} move - 走法对象（走后传入，走前为 null）
     * @param {number} score - AI 视角评分（走前用静态评估，走后用搜索结果）
     * @returns {Object} 上下文对象
     */
    function buildContext(state, move = null, score = 0) {
        const aiData = state.playerAI;
        const oppData = state.playerOpponent;

        const aiMills = EV.analyzeMills(E.TYPE_AI);
        const oppMills = EV.analyzeMills(E.TYPE_OPPONENT);

        const aiTotal = aiData.piecesOnBoard + aiData.piecesOnHand;
        const oppTotal = oppData.piecesOnBoard + oppData.piecesOnHand;

        return {
            // ── 1. 游戏阶段 ──
            phase: {
                ai:       E.getPhase(E.TYPE_AI),
                opponent: E.getPhase(E.TYPE_OPPONENT),
            },

            // ── 2. 局面数据 ──
            pieces: {
                ai:       { onBoard: aiData.piecesOnBoard, onHand: aiData.piecesOnHand, lost: aiData.piecesLost, total: aiTotal },
                opponent: { onBoard: oppData.piecesOnBoard, onHand: oppData.piecesOnHand, lost: oppData.piecesLost, total: oppTotal },
            },
            mills: {
                ai:       aiMills,
                opponent: oppMills,
            },
            mobility: {
                ai:       EV.countMobility(E.TYPE_AI),
                opponent: EV.countMobility(E.TYPE_OPPONENT),
            },

            // ── 3. 走法动态（走后才有，走前为 null）──
            move: move ? {
                type:       move.type,
                from:       move.from,
                to:         move.to,
                remove:     move.remove,
                formedMill: state.millMove,
            } : null,

            // ── 4. 评分 ──
            score: score,

            // ── 5. 重复检测 ──
            repetition: E.getRepetitionCount(),

            // 走前阶段信息（走后保留，用于判断走前的局面状态）
            phaseBefore: null,
        };
    }

    // ==================== 规则库 ====================

    // 匹配方式：收集所有命中的规则，随机选一条
    // 优先级由上到下，高特异性在前

    // ── 快捷谓词 ──

    // 走前/走后
    const isPre = c => !c.move;
    const isPost = c => !!c.move;
    const formedMill = c => c.move && c.move.formedMill;
    const captured = c => c.move && c.move.remove !== null;

    // 1. 游戏阶段
    const placement = c => c.phase.ai === 'PLACEMENT';
    const moving = c => c.phase.ai === 'MOVING';
    const aiFlying = c => c.phase.ai === 'FLYING';
    const oppFlying = c => c.phase.opponent === 'FLYING';
    const ai4 = c => c.pieces.ai.onBoard === 4 && c.pieces.ai.onHand === 0;      // AI 4子（飞行前夕）
    const opp4 = c => c.pieces.opponent.onBoard === 4 && c.pieces.opponent.onHand === 0;  // 对方4子

    // 2. 局面数据
    const forceStrong = c => c.pieces.ai.total >= c.pieces.opponent.total + 3;
    const forceWeak = c => c.pieces.ai.total <= c.pieces.opponent.total - 3;
    const aiMoreMills = c => c.mills.ai.nearMills > c.mills.opponent.nearMills;
    const oppMoreMills = c => c.mills.opponent.nearMills > c.mills.ai.nearMills;
    const lowOppMobility = c => c.mobility.opponent <= 4;
    const lowAiMobility = c => c.mobility.ai <= 4;
    const oppThreatened = c => c.mills.opponent.rollingForks >= 1;
    const aiThreatened = c => c.mills.ai.rollingForks >= 1;
    const oppHasHRF = c => c.mills.opponent.hardRollingForks >= 1;
    const aiHasHRF = c => c.mills.ai.hardRollingForks >= 1;

    // 分数段谓词（AI 视角）
    const scoreWinning = c => c.score >= 2000;       // 必胜
    const scoreAhead = c => c.score >= 200;           // 优势
    const scoreEven = c => c.score > -200 && c.score < 200;  // 拉锯
    const scoreBehind = c => c.score <= -200;         // 劣势
    const scoreLosing = c => c.score <= -2000;        // 必死

    const RULES = [

        // ══════════════════════════════════════════════════
        // A. 走后规则（isPost）
        // ══════════════════════════════════════════════════

        // A1. 成磨 + 吃子 + 对手飞行
        { when: c => isPost(c) && formedMill(c) && captured(c) && oppFlying(c), lines: ['(A1) 成磨吃子+对手飞行'] },
        // A2. 成磨 + 吃子 + 必胜
        { when: c => isPost(c) && formedMill(c) && captured(c) && scoreWinning(c), lines: ['(A2) 成磨吃子+必胜'] },
        // A3. 成磨 + 吃子 + 优势
        { when: c => isPost(c) && formedMill(c) && captured(c) && scoreAhead(c), lines: ['(A3) 成磨吃子+优势'] },
        // A4. 成磨 + 吃子
        { when: c => isPost(c) && formedMill(c) && captured(c), lines: ['(A4) 成磨吃子'] },
        // A5. 吃子（不含成磨）
        { when: c => isPost(c) && captured(c), lines: ['(A5) 吃子'] },
        // A6. 走后对手有 rf
        { when: c => isPost(c) && oppThreatened(c), lines: ['(A6) 走后对手有rf'] },
        // A7. 走后己方有 rf
        { when: c => isPost(c) && aiThreatened(c), lines: ['(A7) 走后己方有rf'] },
        // A8. 走后对手有 hrf
        { when: c => isPost(c) && oppHasHRF(c), lines: ['(A8) 走后对手有hrf'] },
        // A9. 走后己方有 hrf
        { when: c => isPost(c) && aiHasHRF(c), lines: ['(A9) 走后己方有hrf'] },

        // ══════════════════════════════════════════════════
        // B. 阶段规则（isPre + 阶段谓词）
        // ══════════════════════════════════════════════════

        // B1. 对手飞行 + nearMills≥2
        { when: c => isPre(c) && oppFlying(c) && c.mills.ai.nearMills >= 2, lines: ['(B1) 对手飞行+nearMills≥2'] },
        // B2. 对手飞行 + 强势 + 对手受限
        { when: c => isPre(c) && oppFlying(c) && forceStrong(c) && lowOppMobility(c), lines: ['(B2) 对手飞行+强势+对手受限'] },
        // B3. 对手飞行
        { when: c => isPre(c) && oppFlying(c), lines: ['(B3) 对手飞行'] },
        // B4. 己方飞行 + 必死
        { when: c => isPre(c) && aiFlying(c) && scoreLosing(c), lines: ['(B4) 己方飞行+必死'] },
        // B5. 己方飞行 + 劣势
        { when: c => isPre(c) && aiFlying(c) && scoreBehind(c), lines: ['(B5) 己方飞行+劣势'] },
        // B6. 己方飞行
        { when: c => isPre(c) && aiFlying(c), lines: ['(B6) 己方飞行'] },
        // B7. 对方 4 子
        { when: c => isPre(c) && opp4(c), lines: ['(B7) 对方4子'] },
        // B8. 己方 4 子
        { when: c => isPre(c) && ai4(c), lines: ['(B8) 己方4子'] },
        // B9. 放置阶段
        { when: c => isPre(c) && placement(c), lines: ['(B9) 放置阶段'] },
        // B10. 移动阶段
        { when: c => isPre(c) && moving(c), lines: ['(B10) 移动阶段'] },

        // ══════════════════════════════════════════════════
        // C. 局面规则（isPre + 数值谓词）
        // ══════════════════════════════════════════════════

        // C1. 必胜
        { when: c => isPre(c) && scoreWinning(c), lines: ['(C1) 必胜'] },
        // C2. 优势
        { when: c => isPre(c) && scoreAhead(c), lines: ['(C2) 优势'] },
        // C3. 劣势
        { when: c => isPre(c) && scoreBehind(c), lines: ['(C3) 劣势'] },
        // C4. 必死
        { when: c => isPre(c) && scoreLosing(c), lines: ['(C4) 必死'] },
        // C5. 兵力强势 ≥3
        { when: c => isPre(c) && forceStrong(c), lines: ['(C5) 兵力强势'] },
        // C6. 兵力弱势 ≥3
        { when: c => isPre(c) && forceWeak(c), lines: ['(C6) 兵力弱势'] },
        // C7. 己方 nearMill 更多
        { when: c => isPre(c) && aiMoreMills(c), lines: ['(C7) 己方nearMill更多'] },
        // C8. 对手 nearMill 更多
        { when: c => isPre(c) && oppMoreMills(c), lines: ['(C8) 对手nearMill更多'] },
        // C9. 对手机动性低
        { when: c => isPre(c) && lowOppMobility(c), lines: ['(C9) 对手机动性低'] },
        // C10. 己方机动性低
        { when: c => isPre(c) && lowAiMobility(c), lines: ['(C10) 己方机动性低'] },
        // C11. 对手有 rf
        { when: c => isPre(c) && oppThreatened(c), lines: ['(C11) 对手有rf'] },
        // C12. 己方有 rf
        { when: c => isPre(c) && aiThreatened(c), lines: ['(C12) 己方有rf'] },
        // C13. 对手有 hrf
        { when: c => isPre(c) && oppHasHRF(c), lines: ['(C13) 对手有hrf'] },
        // C14. 己方有 hrf
        { when: c => isPre(c) && aiHasHRF(c), lines: ['(C14) 己方有hrf'] },

        // ══════════════════════════════════════════════════
        // D. 通用
        // ══════════════════════════════════════════════════

        // D1. déjà vu
        { when: c => c.repetition >= 2, lines: ['(D1) déjà vu'] },

        // ══════════════════════════════════════════════════
        // 兜底
        // ══════════════════════════════════════════════════
        {
            when: () => true,
            lines: [
                '来吧，继续。',
                '嗯，轮到你了。',
                '慢慢来，不急。',
                '哦，今天心情不错，适合下棋。',
                '棋盘还大着呢，随便走。',
            ]
        },
    ];

    // ==================== 匹配引擎 ====================

    /** 收集所有命中规则，随机选一条，再随机选一行台词 */
    function pickLine(ctx) {
        const hits = [];
        for (let i = 0; i < RULES.length; i++) {
            if (RULES[i].when(ctx)) hits.push(RULES[i]);
        }
        if (hits.length === 0) return '...';
        const rule = hits[Math.floor(Math.random() * hits.length)];
        return rule.lines[Math.floor(Math.random() * rule.lines.length)];
    }

    // ==================== 在线模式（LLM） ====================

    // TODO: online 模式实现
    // function generateOnlineLine(ctx) { ... }

    // ==================== 公开接口 ====================

    /** 设置参数 */
    function configure(opts) {
        Object.assign(config, opts);
    }

    /**
     * 走前消息：AI 思考前调用
     * @param {Object} state - Engine.getStateView()
     * @returns {{ line: string, ctx: Object }}
     */
    function getPreMessage(state) {
        const score = EV.evaluate(0, null);
        const ctx = buildContext(state, null, score);
        const line = config.mode === 'online'
            ? generateOnlineLine(ctx)
            : pickLine(ctx);
        return { line, ctx };
    }

    /**
     * 走后消息：AI 走棋后调用
     * @param {Object} state - Engine.getStateView()（走后的状态）
     * @param {Object} move - AI 刚执行的走法
     * @param {Object} preCtx - getPreMessage 返回的 ctx
     * @param {number} score - AI 搜索结果评分（result.score）
     * @returns {string}
     */
    function getPostMessage(state, move, preCtx, score) {
        const ctx = buildContext(state, move, score);
        ctx.phaseBefore = preCtx.phase;
        return config.mode === 'online'
            ? generateOnlineLine(ctx)
            : pickLine(ctx);
    }

    // ==================== 导出 ====================
    return {
        configure,
        getPreMessage,
        getPostMessage,

        // 供测试/调试
        _RULES: RULES,
    };
})();

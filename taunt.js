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
    const isPre = c => !c.move;
    const isPost = c => !!c.move;
    const ahead = c => c.pieces.ai.total > c.pieces.opponent.total + 1;
    const behind = c => c.pieces.ai.total < c.pieces.opponent.total - 1;
    const oppFlying = c => c.phase.opponent === 'FLYING';
    const aiFlying = c => c.phase.ai === 'FLYING';
    const lowOppMobility = c => c.mobility.opponent <= 4;
    const aiMoreMills = c => c.mills.ai.nearMills > c.mills.opponent.nearMills;
    const oppThreatened = c => c.mills.opponent.hardNearMills >= 1 || c.mills.opponent.rollingForks >= 1;

    // 分数段谓词（AI 视角）
    const scoreWinning = c => c.score >= 2000;       // 必胜
    const scoreAhead = c => c.score >= 200;           // 优势
    const scoreEven = c => c.score > -200 && c.score < 200;  // 拉锯
    const scoreBehind = c => c.score <= -200;         // 劣势
    const scoreLosing = c => c.score <= -2000;        // 必死

    const RULES = [

        // ══════════════════════════════════════════════════
        // 走后规则（需要 ctx.move !== null）
        // ══════════════════════════════════════════════════

        // 成磨 + 吃子 + 对手飞行
        {
            when: c => isPost(c) && c.move.formedMill && c.move.remove !== null && (c.phaseBefore && c.phaseBefore.opponent === 'FLYING'),
            lines: [
                '子少了，路断了，翅膀也折了。',
                '吃一颗子而已，你慌什么？又飞不走。',
                '你的棋子越来越少，路也越来越少，巧了。',
            ]
        },
        // 成磨 + 吃子 + 必胜
        {
            when: c => isPost(c) && c.move.formedMill && c.move.remove !== null && scoreWinning(c),
            lines: [
                '全面进攻，你挡不住。',
                '优势在我，磨坊已开。',
                '收割的时间到了。',
            ]
        },
        // 成磨 + 吃子 + 优势
        {
            when: c => isPost(c) && c.move.formedMill && c.move.remove !== null && scoreAhead(c),
            lines: [
                '火力建制碾压，你就认了吧。',
                '磨坊已开，你挡不住。',
            ]
        },
        // 成磨 + 吃子
        {
            when: c => isPost(c) && c.move.formedMill && c.move.remove !== null,
            lines: [
                '磨坊转起来了，顺便带走一颗子。',
                '三子连线，收网，吃子。一气呵成。',
                '成行是手段，吃子才是目的。',
                '磨坊开了，你的棋子少了一颗。',
                '转一圈，磨一颗。',
            ]
        },
        // 走后给了对手机会（对手有威胁）
        {
            when: c => isPost(c) && oppThreatened(c),
            lines: [
                '你的磨坊我看见了，但我的棋更大。',
                '先让你得意一下，君子报仇十轮不晚。',
                '你以为这样我就会怕吗？等着。',
                '厉害，没挡住。但你别高兴太早。',
                '这一步我吞下了，下一步轮到你颤抖。',
            ]
        },

        // ══════════════════════════════════════════════════
        // 通用规则（走前走后都适用）
        // ══════════════════════════════════════════════════

        // 局面已出现 2 次，再来一次就判和
        {
            when: c => c.repetition >= 2,
            lines: [
                '等等，这个局面……我好像见过。',
                'déjà vu？',
                '历史总是惊人的相似。',
                '这棋……是不是在循环？',
                '我们是不是迷路了？',
            ]
        },

        // ══════════════════════════════════════════════════
        // 走前规则（ctx.move === null）
        // ══════════════════════════════════════════════════

        // ── 飞行阶段：对手飞行 ──

        // 对手飞行 + 己方 nearMill ≥2
        {
            when: c => isPre(c) && oppFlying(c) && c.mills.ai.nearMills >= 2,
            lines: [
                '差一步成行，你好像飞不了？真巧。',
                '磨坊快好了，你慢慢走，反正哪也去不了。',
                '这条线你看着办。能飞的话早就飞了吧？',
            ]
        },
        // 对手飞行 + 兵力优势 + 对手机动性低
        {
            when: c => isPre(c) && oppFlying(c) && ahead(c) && lowOppMobility(c),
            lines: [
                '路在我脚下，磨坊在眼前，你飞不起来。',
                '四通八达，磨坊将成，你已经没路了。',
                '我的路越走越宽，你的路越走越窄。',
            ]
        },
        // 对手飞行
        {
            when: c => isPre(c) && oppFlying(c),
            lines: [
                '放心吧，我不会轻易放你飞的。',
                '你以为逆风翻盘的机会到了？没风，哈哈。',
                '空域管制，禁止起飞。',
                '你能耐，你飞过去啊。',
                '飞？想得美。',
                '最后三颗子的滋味如何？慢慢享受。',
            ]
        },

        // ── 飞行阶段：己方飞行 ──

        // 己方飞行 + 必死
        {
            when: c => isPre(c) && aiFlying(c) && scoreLosing(c),
            lines: [
                '大不了从头再来。你赶紧的，料理后事我们重开。',
                '你别逼我，逼我我就……认输。',
                '输给你不丢人……吧？',
                '我承认你厉害，但你能不能别那么厉害？',
            ]
        },
        // 己方飞行 + 劣势
        {
            when: c => isPre(c) && aiFlying(c) && scoreBehind(c),
            lines: [
                '我觉得我还能救一救。',
                '等等，让我想想，一定有办法的。',
                '别催，我在想绝地反击的剧本。',
                '你先别得意，也许或者可能我会突然翻盘……吧……',
            ]
        },
        // 己方飞行
        {
            when: c => isPre(c) && aiFlying(c),
            lines: [
                '你赢了棋，但你赢不了我的心。',
                '这一步我先记下，秋后算账。',
                '你笑吧，反正我也拦不住。',
                '做人留一线，他朝好相见。',
            ]
        },

        // ── 分数段规则 ──

        // 必胜
        {
            when: c => isPre(c) && scoreWinning(c),
            lines: [
                '结局已经写好了，你慢慢走。',
                '这盘棋没什么悬念了。',
                '你可以认了。',
            ]
        },
        // 必死
        {
            when: c => isPre(c) && scoreLosing(c),
            lines: [
                '我的错，我反思。',
                '这局能不算吗，你撤单吧，重开。',
                '谁来管管这个人。',
                '我裂开了。',
            ]
        },

        // ── 局面规则 ──

        // 对手机动性低
        {
            when: c => isPre(c) && lowOppMobility(c),
            lines: [
                '巨大的包围圈，正在收缩。',
                '走自己的路，让别人无路可走。',
                '收紧绞索，你无处可逃。',
                '你的活动空间正在蒸发。',
                '窒息的感觉如何？',
                '还有地方走吗？我帮你数数。',
                '每走一步，路就少一条。',
                '棋盘很大，但属于你的角落越来越小。',
            ]
        },
        // 己方 nearMill 更多
        {
            when: c => isPre(c) && aiMoreMills(c),
            lines: [
                '这步棋平平无奇？你自己品。',
                '安静。别打扰我布局。',
                '你没发现？那最好。',
                '走着走着，磨坊就来了。',
            ]
        },
        // 放置阶段
        {
            when: c => isPre(c) && c.phase.ai === 'PLACEMENT',
            lines: [
                '开局而已，看看坐哪合适。',
                '先占个坑，后面再说。',
                '慢慢放，慢慢占，不急。',
                '人越来越多了，我得找个宽敞地儿。',
                '棋盘还空着，先逛逛。',
                '这一步不重要？那你再想想。',
            ]
        },

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

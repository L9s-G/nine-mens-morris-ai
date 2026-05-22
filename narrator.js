// ========================================================
// Nine Men's Morris 语义叙述者 (Narrator)
// 版本：v1.0
// 特性：
//   - 离线模式：基于 tags/模式/情绪从本地词库抽取对白
//   - 在线模式：生成 LLM System Prompt
//   - 情绪系统：根据 materialDiff 动态调整语气
//   - 陷阱话术：HiddenTrap 专属诱导性台词
// ========================================================

const Narrator = (() => {

    // ==================== 离线词库 ====================

    // 按策略模式分类的台词
    const MODE_TEMPLATES = {
        EXPANSION: [
            "棋盘上的每一处落子，都是为了最后的合围。",
            "你只看到了眼前的棋子，而我看到了整张网。",
            "布局尚未完成，你已经急不可耐了？",
            "每一步都是伏笔，每一子都是棋局。",
            "耐心，是宗师的第一课。"
        ],
        SUPPRESSION: [
            "感觉到呼吸困难了吗？你的活动空间正在消失。",
            "困兽之斗。你每走一步，都是在自寻死路。",
            "收紧绞索，你无处可逃。",
            "你的棋子在颤抖，你听到了吗？",
            "我不是在下棋，我是在收网。"
        ],
        DECISIVE: [
            "游戏结束了。从现在开始，只有收割。",
            "这就是决战的节奏，你跟得上吗？",
            "最后一击，绝不留情。",
            "你的挣扎毫无意义。",
            "终结。"
        ]
    };

    // 按标签分类的台词
    const TAG_TEMPLATES = {
        MILL: [
            "磨坊转动，你的棋子消逝。",
            "成行。收割。",
            "三子连线，天经地义。"
        ],
        BLOCK: [
            "想在这里成行？太天真了。",
            "你的如意算盘，我早已看穿。",
            "此路不通。"
        ],
        CAPTURE: [
            "这颗棋子，我收下了。",
            "少一子，多一分绝望。",
            "吃子只是开始。"
        ],
        SQUEEZE: [
            "收紧绞索，你无处可逃。",
            "你的活动空间正在蒸发。",
            "窒息的感觉如何？"
        ],
        HUB_CONTROL: [
            "枢纽在手，天下我有。",
            "这个位置，是棋盘的心脏。",
            "占据中心，掌控全局。"
        ],
        HIDDEN_TRAP: [
            "这步棋我大意了，你敢吃吗？",
            "看来我也有计算失误的时候，这一子算我送你的。",
            "哎呀，走错了。你不会放过这个机会吧？",
            "这一步...是我的破绽？还是你的坟墓？"
        ],
        RISKY: [
            "赌一把？",
            "高风险，高回报。",
            "你敢跟吗？"
        ]
    };

    // 情绪修饰符（根据 materialDiff 调整语气）
    const EMOTION_MODIFIERS = {
        arrogant: {  // 大幅优势
            prefix: ["呵，", "哼，", ""],
            suffix: ["不过如此。", "你已经输了。", "认输吧。"]
        },
        confident: {  // 小幅优势
            prefix: ["", "嗯，", ""],
            suffix: ["", "继续。", "你没机会了。"]
        },
        neutral: {  // 均势
            prefix: ["", "", ""],
            suffix: ["", "", ""]
        },
        cautious: {  // 小幅劣势
            prefix: ["", "这一步...", "且慢。"],
            suffix: ["", "我们走着瞧。", "还没结束。"]
        },
        desperate: {  // 大幅劣势
            prefix: ["不可能...", "这...", "等等。"],
            suffix: ["我还有机会。", "还没结束。", "绝地反击。"]
        }
    };

    // ==================== 情绪判断 ====================

    /**
     * 根据材料差判断情绪
     */
    function getEmotion(materialDiff) {
        if (materialDiff >= 3) return 'arrogant';
        if (materialDiff >= 1) return 'confident';
        if (materialDiff === 0) return 'neutral';
        if (materialDiff >= -2) return 'cautious';
        return 'desperate';
    }

    /**
     * 从数组中随机选取一个元素
     */
    function randomPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ==================== 离线台词生成 ====================

    /**
     * 离线模式：基于标签、模式、情绪生成台词
     */
    function getOfflineLine(bestMove, mode, materialDiff) {
        const emotion = getEmotion(materialDiff);
        const modifier = EMOTION_MODIFIERS[emotion];

        // 优先级：HIDDEN_TRAP > 特定标签 > 模式台词
        let line = '';

        if (bestMove.tags.includes('HIDDEN_TRAP')) {
            line = randomPick(TAG_TEMPLATES.HIDDEN_TRAP);
        } else if (bestMove.tags.includes('MILL')) {
            line = randomPick(TAG_TEMPLATES.MILL);
        } else if (bestMove.tags.includes('BLOCK')) {
            line = randomPick(TAG_TEMPLATES.BLOCK);
        } else if (bestMove.tags.includes('CAPTURE')) {
            line = randomPick(TAG_TEMPLATES.CAPTURE);
        } else if (bestMove.tags.includes('SQUEEZE')) {
            line = randomPick(TAG_TEMPLATES.SQUEEZE);
        } else if (bestMove.tags.includes('HUB_CONTROL')) {
            line = randomPick(TAG_TEMPLATES.HUB_CONTROL);
        } else {
            // 没有特定标签，使用模式台词
            const modeLines = MODE_TEMPLATES[mode] || MODE_TEMPLATES.EXPANSION;
            line = randomPick(modeLines);
        }

        // 添加情绪修饰
        const prefix = randomPick(modifier.prefix);
        const suffix = randomPick(modifier.suffix);

        return prefix + line + suffix;
    }

    // ==================== 在线 Prompt 生成 ====================

    /**
     * 在线模式：生成给 LLM 的 System Prompt
     */
    function createPrompt(report, bestMove, mode) {
        const emotion = getEmotion(report.context.materialDiff);

        return {
            role: "system",
            content: `你是一位Nine Men's Morris宗师，性格冷酷而自信。

当前博弈状态：
- 阶段：${report.context.phase}
- 策略模式：${mode}
- 材料差：${report.context.materialDiff}（正=你优势，负=对手优势）
- 机动性差值：${report.metrics.mobilityGap}
- 情绪基调：${emotion}

你刚做出的走法：${bestMove.description}
走法标签：${bestMove.tags.join(', ')}
走法风险：${bestMove.risk}

要求：
1. 生成一句简短（20字以内）的宗师点评
2. 语气符合当前情绪基调（优势时傲慢，劣势时冷静，均势时深沉）
3. 如果标签包含 HIDDEN_TRAP，假装这是失误，诱导对手上钩
4. 不要提及具体的棋盘坐标或技术细节`
        };
    }

    // ==================== 统一接口 ====================

    /**
     * 获取台词
     * @param {object} report - 战术报告
     * @param {object} bestMove - AI 选择的最佳走法（含 score, tags, risk, description）
     * @param {string} mode - 策略模式
     * @param {boolean} isOnline - 是否在线模式
     * @returns {string|object} 离线返回字符串，在线返回 Prompt 对象
     */
    function getLine(report, bestMove, mode, isOnline = false) {
        if (!isOnline) {
            return getOfflineLine(bestMove, mode, report.context.materialDiff);
        }
        return createPrompt(report, bestMove, mode);
    }

    // ==================== 公开接口 ====================
    return {
        getLine,
        getOfflineLine,
        createPrompt,
        getEmotion,

        // 暴露词库供测试或扩展
        _MODE_TEMPLATES: MODE_TEMPLATES,
        _TAG_TEMPLATES: TAG_TEMPLATES
    };
})();

// ========================================================
// Nine Men's Morris 语义叙述者 (Narrator)
// 版本：v2.0 - 组合标签系统
// 特性：
//   - 离线模式：组合标签优先匹配 → 单标签回退 → 模式台词
//   - 在线模式：生成 LLM System Prompt
//   - 情绪系统：根据 forceDiff 动态调整语气
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

    // 按标签组合分类的台词（同级内按实战频率排序）
    const COMBO_TEMPLATES = {
        // ========== 4标签组合（最精确，优先匹配） ==========
        // HUB_CONTROL + NEAR_MILL + ANTI_FLYING + DECISIVE_STRIKE（74次）：全面压制
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE': [
            "枢纽、磨坊、禁飞——你已经是个死人了。",
            "全面封锁，致命一击。",
            "这一手，结束一切。"
        ],
        // HUB_CONTROL + ANTI_FLYING + BLOCK + DECISIVE_STRIKE（42次）：枢纽+禁飞+封锁+致命
        'HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE': [
            "心脏归我，翅膀折断，此路不通。",
            "你已经无路可走了。",
            "四重封锁，认输吧。"
        ],

        // ========== 3标签组合 ==========
        // HUB_CONTROL + NEAR_MILL + LAYOUT（112次）：开局抢占枢纽，布局成行
        'HUB_CONTROL+NEAR_MILL+LAYOUT': [
            "枢纽归我，磨坊已在路上。",
            "这一步布局，三手之后你就懂了。",
            "先取心脏，再收性命。"
        ],
        // HUB_CONTROL + NEAR_MILL + ANTI_FLYING（79次）：枢纽+近磨+禁飞
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING': [
            "枢纽归我，磨坊在路上，你的翅膀也被折断了。",
            "三重绞杀，无处可逃。",
            "心脏在我手里，你的棋子只能等死。"
        ],
        // ANTI_FLYING + BLOCK + DECISIVE_STRIKE（60次）：禁飞+封锁+致命
        'ANTI_FLYING+BLOCK+DECISIVE_STRIKE': [
            "飞不起来，走不动路，这就是绝境。",
            "你的棋子已经被判了死刑。",
            "翅膀折了，路也断了。"
        ],
        // HUB_CONTROL + BLOCK + LAYOUT（43次）：枢纽+封锁+布局
        'HUB_CONTROL+BLOCK+LAYOUT': [
            "枢纽在手，你的如意算盘落空了。",
            "布局中，顺便断你一条路。",
            "这个位置，攻守兼备。"
        ],
        // NEAR_MILL + RISKY + DECISIVE_STRIKE（34次）：近磨+冒险+致命
        'NEAR_MILL+RISKY+DECISIVE_STRIKE': [
            "赌你不敢拦这一步。",
            "高风险？不，这是必杀。",
            "这一手看似冒险，实则致命。"
        ],
        // CAPTURE + ANTI_FLYING + BLOCK（34次）：吃子+禁飞+封锁
        'CAPTURE+ANTI_FLYING+BLOCK': [
            "吃你的子，折你的翅，断你的路。",
            "三重打击，你还在挣扎什么？",
            "棋子少了，翅膀折了，路也堵了。"
        ],

        // ========== 2标签组合（子集匹配，精确组合未命中时回退） ==========
        // NEAR_MILL + DECISIVE_STRIKE（84次）：即将成行+致命一击
        'NEAR_MILL+DECISIVE_STRIKE': [
            "差一子成行，而这一步，就是那最后一子。",
            "磨坊已就绪，收割开始。",
            "看到这条线了吗？你拦不住。"
        ],
        // CAPTURE + BLOCK（63次）：吃子+封锁
        'CAPTURE+BLOCK': [
            "吃子是假，封路是真。",
            "你的棋子我收下，你的路线也到此为止。",
            "一子落，两处绝。"
        ],
        // NEAR_MILL + ANTI_FLYING（52次）：近磨+禁飞
        'NEAR_MILL+ANTI_FLYING': [
            "磨坊将成，你的棋子连飞都飞不了。",
            "成行在即，你只能眼睁睁看着。",
            "近在咫尺，远在天涯——对你来说。"
        ],
        // BLOCK + DECISIVE_STRIKE（38次）：封锁+致命一击
        'BLOCK+DECISIVE_STRIKE': [
            "此路不通，而这就是你的末路。",
            "封锁只是序曲，致命一击才是正文。",
            "断你退路，取你性命。"
        ],
        // HUB_CONTROL + DECISIVE_STRIKE（29次）：枢纽+致命
        'HUB_CONTROL+DECISIVE_STRIKE': [
            "占据心脏，一击致命。",
            "枢纽在手，胜负已分。",
            "这个位置，就是你的坟墓。"
        ],
        // RISKY + DECISIVE_STRIKE（21次）：冒险+致命
        'RISKY+DECISIVE_STRIKE': [
            "高风险，高回报——这一手赌的是你的命。",
            "看似冒险，实则必杀。",
            "你敢跟吗？不敢就输了。"
        ],
        // NEAR_MILL + RISKY（18次）：近磨+冒险
        'NEAR_MILL+RISKY': [
            "赌一把？赌你拦不住我成行。",
            "这一步有风险，但磨坊的诱惑更大。",
            "冒险？不，这是精准计算。"
        ],

        // ========== 特殊：HIDDEN_TRAP ==========
        'HIDDEN_TRAP': [
            "这步棋我大意了，你敢吃吗？",
            "看来我也有计算失误的时候，这一子算我送你的。",
            "哎呀，走错了。你不会放过这个机会吧？",
            "这一步...是我的破绽？还是你的坟墓？"
        ]
    };

    // 按单标签分类的台词（组合未命中时的回退）
    const TAG_TEMPLATES = {
        MILL: [
            "磨坊转动，你的棋子消逝。",
            "成行。收割。",
            "三子连线，天经地义。"
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
        BLOCK: [
            "想在这里成行？太天真了。",
            "你的如意算盘，我早已看穿。",
            "此路不通。"
        ],
        DECISIVE_STRIKE: [
            "致命一击，胜负已分。",
            "这一手，决定了整盘棋的走向。",
            "精准。致命。不给你任何机会。"
        ],
        NEAR_MILL: [
            "差一子成行，你拦得住吗？",
            "磨坊将至，你感受到了吗？",
            "这条线，已经无法阻止了。"
        ],
        ANTI_FLYING: [
            "翅膀被折断了，飞不起来了吧？",
            "你的棋子已经失去了飞行的自由。",
            "禁飞区已划定，你只能老老实实走路。"
        ],
        HUB_CONTROL: [
            "枢纽在手，天下我有。",
            "这个位置，是棋盘的心脏。",
            "占据中心，掌控全局。"
        ],
        LAYOUT: [
            "布局阶段，每一步都是伏笔。",
            "看似平淡，实则暗藏杀机。",
            "布局未完，你已经急了？"
        ],
        SUPPRESSION: [
            "感觉到呼吸困难了吗？",
            "你的活动空间正在消失。",
            "收网开始了。"
        ],
        RISKY: [
            "赌一把？",
            "高风险，高回报。",
            "你敢跟吗？"
        ]
    };

    // 情绪修饰符（根据 forceDiff 调整语气）
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
     * 根据兵力差判断情绪
     */
    function getEmotion(forceDiff) {
        if (forceDiff >= 3) return 'arrogant';
        if (forceDiff >= 1) return 'confident';
        if (forceDiff === 0) return 'neutral';
        if (forceDiff >= -2) return 'cautious';
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
     * 离线模式：组合标签优先 → 单标签回退 → 模式台词 + 情绪修饰
     */
    // 组合匹配优先级（特异性优先：4标签 > 3标签 > 2标签，同级内按频率排序）
    const COMBO_PRIORITY = [
        // 4标签
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE',
        'HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE',
        // 3标签
        'HUB_CONTROL+NEAR_MILL+LAYOUT',
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING',
        'ANTI_FLYING+BLOCK+DECISIVE_STRIKE',
        'HUB_CONTROL+BLOCK+LAYOUT',
        'NEAR_MILL+RISKY+DECISIVE_STRIKE',
        'CAPTURE+ANTI_FLYING+BLOCK',
        // 2标签
        'NEAR_MILL+DECISIVE_STRIKE',
        'CAPTURE+BLOCK',
        'NEAR_MILL+ANTI_FLYING',
        'BLOCK+DECISIVE_STRIKE',
        'HUB_CONTROL+DECISIVE_STRIKE',
        'RISKY+DECISIVE_STRIKE',
        'NEAR_MILL+RISKY',
        // 特殊
        'HIDDEN_TRAP'
    ];

    // 单标签回退优先级
    const TAG_PRIORITY = [
        'MILL', 'CAPTURE', 'SQUEEZE', 'BLOCK',
        'DECISIVE_STRIKE', 'NEAR_MILL', 'ANTI_FLYING',
        'HUB_CONTROL', 'LAYOUT', 'SUPPRESSION', 'RISKY'
    ];

    /**
     * 检查 tags 是否包含指定组合的所有标签
     */
    function hasCombo(tags, comboKey) {
        const required = comboKey.split('+');
        return required.every(tag => tags.includes(tag));
    }

    function getOfflineLine(bestMove, mode, forceDiff) {
        const emotion = getEmotion(forceDiff);
        const modifier = EMOTION_MODIFIERS[emotion];
        const tags = bestMove.tags || [];

        let line = '';

        // 1. 优先匹配组合标签
        for (const comboKey of COMBO_PRIORITY) {
            if (hasCombo(tags, comboKey)) {
                line = randomPick(COMBO_TEMPLATES[comboKey]);
                break;
            }
        }

        // 2. 回退到单标签
        if (!line) {
            for (const tag of TAG_PRIORITY) {
                if (tags.includes(tag) && TAG_TEMPLATES[tag]) {
                    line = randomPick(TAG_TEMPLATES[tag]);
                    break;
                }
            }
        }

        // 3. 最终回退到模式台词
        if (!line) {
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
        const emotion = getEmotion(report.context.forceDiff);

        return {
            role: "system",
            content: `你是一位Nine Men's Morris宗师，性格冷酷而自信。

当前博弈状态：
- 阶段：${report.context.phase}
- 策略模式：${mode}
- 兵力差：${report.context.forceDiff}（正=你优势，负=对手优势）
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
            return getOfflineLine(bestMove, mode, report.context.forceDiff);
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
        _TAG_TEMPLATES: TAG_TEMPLATES,
        _COMBO_TEMPLATES: COMBO_TEMPLATES,
        _COMBO_PRIORITY: COMBO_PRIORITY,
        _TAG_PRIORITY: TAG_PRIORITY
    };
})();

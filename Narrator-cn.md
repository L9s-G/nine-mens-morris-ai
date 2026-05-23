# Nine Men's Morris 语义叙述者设计规范

## 1. 概述

Narrator 是 AI 引擎的"表达层"模块，负责将结构化战术数据转化为人类可读的宗师风格台词。支持两种工作模式：

- **离线模式**：基于标签组合、策略模式、情绪状态从本地词库抽取对白，零网络依赖
- **在线模式**：生成 LLM System Prompt，由大模型生成自然语言点评

核心设计理念：**组合标签优先匹配**。基于 1804 个实战样本的标签频率分析，构建了 16 个高频标签组合模板，有效覆盖率从优化前的 ~17% 提升至 88.1%。

## 2. 系统架构

Narrator 采用"词库-匹配-修饰"三层流水线：

```
输入: bestMove.tags + mode + score
        │
        ▼
┌─────────────────────┐
│  1. 组合标签匹配     │  COMBO_PRIORITY → COMBO_TEMPLATES
│     (特异性优先)     │  4标签 > 3标签 > 2标签
└─────────┬───────────┘
          │ 未命中
          ▼
┌─────────────────────┐
│  2. 单标签回退       │  TAG_PRIORITY → TAG_TEMPLATES
└─────────┬───────────┘
          │ 未命中
          ▼
┌─────────────────────┐
│  3. 模式台词兜底     │  MODE_TEMPLATES[mode]
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  4. 情绪修饰         │  prefix + line + suffix
│     (score)          │  EMOTION_MODIFIERS[emotion]
└─────────────────────┘
          │
          ▼
       输出台词
```

## 3. 离线词库

### 3.1 组合标签模板 (COMBO_TEMPLATES)

基于实战对战数据（24 场循环赛，1804 手）的标签频率分析构建。按特异性分层：

#### 4 标签组合（最精确，优先匹配）

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE` | 74 | 全面压制：路宽+近磨+禁飞+致命 | "路在我脚下，磨坊在眼前，你飞不起来。" |
| `HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE` | 42 | 路宽+禁飞+封锁+致命 | "我的路四通八达，你的翅膀折了，退路也断了。" |

#### 3 标签组合

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `HUB_CONTROL+NEAR_MILL+LAYOUT` | 112 | 路宽+近磨+布局 | "多一条路，磨坊就近一步。" |
| `HUB_CONTROL+NEAR_MILL+ANTI_FLYING` | 79 | 路宽+近磨+禁飞 | "路在我这边，磨坊在路上，你的翅膀也折了。" |
| `ANTI_FLYING+BLOCK+DECISIVE_STRIKE` | 60 | 禁飞+封锁+致命 | "你说你还有几步可走？我帮你数，零。" |
| `HUB_CONTROL+BLOCK+LAYOUT` | 43 | 路宽+封锁+布局 | "我的路越走越宽，你的路少了一条。" |
| `NEAR_MILL+RISKY+DECISIVE_STRIKE` | 34 | 近磨+冒险+致命 | "你的磨坊我看在眼里，但我的更快。" |
| `CAPTURE+ANTI_FLYING+BLOCK` | 34 | 吃子+禁飞+封锁 | "子少了，路断了，对了你还有翅膀……哦不好意思。" |

#### 2 标签组合（子集匹配，精确组合未命中时回退）

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `NEAR_MILL+DECISIVE_STRIKE` | 84 | 近磨+决战 | "差一子成行，这是我最后的机会。" |
| `CAPTURE+BLOCK` | 63 | 吃子+封锁 | "吃子是假，封路是真。" |
| `NEAR_MILL+ANTI_FLYING` | 52 | 近磨+禁飞 | "差一步成行，对了你好像飞不了？真巧。" |
| `BLOCK+DECISIVE_STRIKE` | 38 | 封锁+决战 | "挡住了。现在轮到我了。" |
| `HUB_CONTROL+DECISIVE_STRIKE` | 29 | 路宽+致命 | "进可攻退可守，这一击你躲不掉。" |
| `RISKY+DECISIVE_STRIKE` | 21 | 冒险+致命 | "你有反击？我知道。但这步棋你拦不住。" |
| `NEAR_MILL+RISKY` | 18 | 近磨+冒险 | "你的磨坊我看在眼里，但这条线我先走完。" |

#### 特殊

| 组合 | 说明 |
|------|------|
| `HIDDEN_TRAP` | 诱导性台词，假装失误引诱对手上钩 |

### 3.2 单标签模板 (TAG_TEMPLATES)

组合未命中时的回退词库，覆盖所有 11 种引擎标签：

| 标签 | 含义 | 示例台词 |
|------|------|---------|
| `MILL` | 形成磨坊 | （已合并到 MILL+CAPTURE 组合） |
| `CAPTURE` | 吃子 | （已合并到 MILL+CAPTURE 组合） |
| `SQUEEZE` | 挤压空间（≤2 步可走） | "巨大的包围圈，正在收缩。" |
| `BLOCK` | 封锁 | "想在这里成行？太天真了。" |
| `DECISIVE_STRIKE` | 绝境决战 | "没有退路了，那就拼到底。" |
| `NEAR_MILL` | 差一步成行 | "这步棋平平无奇？你自己品。" |
| `ANTI_FLYING` | 限制飞行 | "放心吧，我不会轻易放你飞的。" |
| `HUB_CONTROL` | 路宽（≥2 空邻居） | "多一条路，多一分活路。" |
| `LAYOUT` | 布局阶段 | "先占个坑，后面再说。" |
| `SUPPRESSION` | 压制 | （已清空，影响力不足） |
| `RISKY` | 冒险走法 | "你的磨坊我看见了，但我的棋更大。" |

### 3.3 模式模板 (MODE_TEMPLATES)

最终兜底，按策略模式提供通用台词：

| 模式 | 触发条件 | 风格 | 示例台词 |
|------|---------|------|---------|
| `EXPANSION` | 默认模式 | 随意闲聊 | "来吧，继续。" / "棋盘还大着呢，随便走。" |
| `SUPPRESSION` | MOVING 阶段 + 机动性差 > 4 | 凡尔赛式炫耀 | "我都选择困难症了，你是正困难选择中吧。" |
| `DECISIVE` | forceDiff < -1 / 对手接近飞行 / 飞行阶段 | 绝境求生、各种挣扎 | "我觉得我还能救一救。" / "大不了从头再来。你赶紧的，料理后事我们重开。" |

## 4. 情绪系统

### 4.1 情绪判断

根据 minimax 综合评估分（`bestMove.score`）映射到 5 种情绪。评分基于 24 局实战数据校准：

| 评分范围 | 情绪 | 占比 | 风格 |
|---------|------|------|------|
| ≥ 500 | `arrogant`（傲慢） | ~15% | 嘲笑、质疑实力 |
| 100 ~ 499 | `confident`（压不住笑） | ~30% | 假装淡定、憋笑 |
| -99 ~ 99 | `neutral`（中性） | ~28% | 无修饰 |
| -399 ~ -100 | `cautious`（嘴硬） | ~19% | 不承认劣势、挑衅 |
| < -400 | `desperate`（搞笑求饶） | ~6% | 卖惨、自嘲 |

### 4.2 修饰叠加

情绪修饰通过前缀 (prefix) 和后缀 (suffix) 叠加到台词上：

```
最终台词 = prefix + line + suffix
```

- prefix 和 suffix 从各自数组中随机选取
- `neutral` 的 prefix/suffix 均为空字符串，不改变台词原貌
- `arrogant`：嘲笑质疑（"哈哈，" / "这就是你的全部实力吗？"）
- `confident`：压不住笑（"咳，" / "别弃垒。"）
- `cautious`：嘴硬不认输（"嗯？" / "你当我会怕？"）
- `desperate`：搞笑求饶（"啊这……" / "救救我。"）

## 5. 匹配算法

### 5.1 组合匹配优先级

组合模板按**特异性**（标签数量）排序，而非单纯频率：

```
4标签组合 > 3标签组合 > 2标签组合 > HIDDEN_TRAP
```

同级内按实战频率降序。这确保了当 tags 包含多个标签时，最精确的组合被优先匹配。

**示例**：tags = `['NEAR_MILL', 'RISKY', 'DECISIVE_STRIKE']`
- 不会误匹配 2 标签的 `NEAR_MILL+DECISIVE_STRIKE`
- 正确匹配 3 标签的 `NEAR_MILL+RISKY+DECISIVE_STRIKE`

### 5.2 子集匹配机制

组合匹配使用子集检测：只要 tags **包含**组合所需的所有标签即命中，允许 tags 有额外标签。

```javascript
function hasCombo(tags, comboKey) {
    const required = comboKey.split('+');
    return required.every(tag => tags.includes(tag));
}
```

这意味着 `tags = ['CAPTURE', 'BLOCK', 'SUPPRESSION']` 会命中 `CAPTURE+BLOCK`（因为包含了所需标签），而不会要求精确匹配。

### 5.3 完整匹配流程

```
1. COMBO_PRIORITY 遍历（特异性优先）
   ├── 命中 → 从 COMBO_TEMPLATES 取台词 → 跳到 4
   └── 全部未命中 → 继续

2. TAG_PRIORITY 遍历（单标签）
   ├── 命中 → 从 TAG_TEMPLATES 取台词 → 跳到 4
   └── 全部未命中 → 继续

3. MODE_TEMPLATES[mode] 兜底

4. 情绪修饰叠加（prefix + line + suffix）
```

## 6. 在线模式 (LLM Prompt)

在线模式不使用本地词库，而是生成结构化 System Prompt 交给 LLM 生成台词。

### 6.1 Prompt 结构

```
角色设定：Nine Men's Morris 宗师，性格冷酷而自信

博弈状态：
- 阶段（PLACEMENT / MOVING / FLYING）
- 策略模式（EXPANSION / SUPPRESSION / DECISIVE）
- 兵力差（正=优势，负=劣势）
- 机动性差值
- 情绪基调（由 minimax 评分自动推导）

走法信息：
- 描述、标签

生成要求：
1. 20 字以内
2. 语气符合情绪基调
3. HIDDEN_TRAP 时假装失误
4. 不提及坐标或技术细节
```

### 6.2 离线 vs 在线对比

| 维度 | 离线模式 | 在线模式 |
|------|---------|---------|
| 网络依赖 | 无 | 需要 LLM API |
| 台词质量 | 固定词库，风格一致 | 自然语言，灵活多变 |
| 延迟 | < 1ms | 取决于 API |
| 适用场景 | 单机 / 性能敏感 | 在线 / 追求沉浸感 |

## 7. 覆盖率分析

基于 24 场 AI 循环赛（Eco / Normal / Master 全配对 × 4 轮）的 1804 手实战数据：

| 匹配层级 | 样本数 | 占比 |
|---------|--------|------|
| 组合匹配 | 1120 | 62.1% |
| 单标签匹配 | 470 | 26.1% |
| 模式回退（空标签） | 214 | 11.9% |
| **有效覆盖** | **1590** | **88.1%** |

11.9% 的模式回退全部来自空标签 `[]`（引擎在某些局面下不产生标签），属于正常行为。

### 7.1 标签频率分布（Top 12）

| 标签 | 出现次数 | 是否有模板 |
|------|---------|-----------|
| `NEAR_MILL` | 718 | 是（新增） |
| `BLOCK` | 589 | 是 |
| `HUB_CONTROL` | 572 | 是 |
| `DECISIVE_STRIKE` | 560 | 是（新增） |
| `ANTI_FLYING` | 512 | 是（新增） |
| `CAPTURE` | 385 | 是 |
| `RISKY` | 369 | 是 |
| `LAYOUT` | 241 | 是（新增） |
| `SUPPRESSION` | 201 | 是（新增） |
| `MILL` | 193 | 是 |
| `SQUEEZE` | 165 | 是 |
| `HIDDEN_TRAP` | — | 是（引擎特殊标签） |

## 8. 公开接口

```javascript
Narrator.getLine(report, bestMove, mode, isOnline)
// 统一入口。isOnline=false 返回字符串，isOnline=true 返回 Prompt 对象
// 情绪由 bestMove.score 驱动

Narrator.getOfflineLine(bestMove, mode, score)
// 离线台词生成（score 为 minimax 评估分）

Narrator.createPrompt(report, bestMove, mode)
// 在线 Prompt 生成

Narrator.getEmotion(score)
// minimax 评分 → 情绪字符串
```

### 8.1 bestMove 结构

```javascript
{
    score: 150,           // minimax 评估分（驱动情绪）
    tags: ['NEAR_MILL', 'DECISIVE_STRIKE'],  // 语义标签（驱动台词）
    description: '...'    // 走法描述
}
```

### 8.2 report 结构

```javascript
{
    context: {
        phase: 'MOVING',
        forceDiff: 2,          // 兵力差
        isOpponentNearFlying: false,
        desperationLevel: 0
    },
    metrics: {
        mobilityGap: 3,
        tensionScore: 15
    }
}
```

## 9. 扩展指南

### 9.1 添加新台词

1. **单标签台词**：在 `TAG_TEMPLATES[tag]` 数组中追加字符串
2. **组合台词**：在 `COMBO_TEMPLATES[comboKey]` 数组中追加字符串
3. **新模式台词**：在 `MODE_TEMPLATES` 中添加新模式或追加到现有数组

### 9.2 添加新组合

1. 在 `COMBO_TEMPLATES` 中添加 `'TAG1+TAG2': [...]` 条目
2. 在 `COMBO_PRIORITY` 数组中按特异性插入正确位置（4标签 > 3标签 > 2标签）
3. 运行覆盖率分析脚本验证匹配效果

### 9.3 调整情绪阈值

修改 `getEmotion(score)` 中的数值即可。基于 24 局实战评分分布（1471 手样本）校准：

```
arrogant:  score >= 500     (p90+，约 15%)
confident: score >= 100     (p50~p90，约 30%)
neutral:   score >= -100    (p25~p50，约 28%)
cautious:  score >= -400    (p10~p25，约 19%)
desperate: score < -400     (p10-，约 6%)
```

### 9.4 调试与测试

暴露内部数据结构供测试：

```javascript
Narrator._COMBO_TEMPLATES   // 组合模板
Narrator._COMBO_PRIORITY    // 组合优先级
Narrator._TAG_TEMPLATES     // 单标签模板
Narrator._TAG_PRIORITY      // 单标签优先级
Narrator._MODE_TEMPLATES    // 模式模板
```

#!/bin/bash
# Nine Men's Morris AI 循环赛
# 3 级 AI（Eco / Normal / Master）
# 每对 4 轮（轮流先手），同级对战也是 4 轮
# 共 6 组 × 4 轮 = 24 场

cd "$(dirname "$0")"
rm -rf battle_logs
mkdir -p battle_logs

echo "=== Nine Men's Morris AI 循环赛（24 场） ==="
echo ""

# 对战配置：模式1 模式2 轮次
BATTLES=(
    # 跨级对战
    "Eco Normal 1"
    "Normal Eco 2"
    "Eco Normal 3"
    "Normal Eco 4"

    "Eco Master 1"
    "Master Eco 2"
    "Eco Master 3"
    "Master Eco 4"

    "Normal Master 1"
    "Master Normal 2"
    "Normal Master 3"
    "Master Normal 4"

    # 同级对战
    "Eco Eco 1"
    "Eco Eco 2"
    "Eco Eco 3"
    "Eco Eco 4"

    "Normal Normal 1"
    "Normal Normal 2"
    "Normal Normal 3"
    "Normal Normal 4"

    "Master Master 1"
    "Master Master 2"
    "Master Master 3"
    "Master Master 4"
)

PIDS=()

for BATTLE in "${BATTLES[@]}"; do
    read -r MODE1 MODE2 ROUND <<< "$BATTLE"
    LOGFILE="battle_logs/${MODE1}_vs_${MODE2}_r${ROUND}.log"
    echo "启动: ${MODE1} vs ${MODE2} 第${ROUND}轮 → ${LOGFILE}"
    node battle.js "$MODE1" "$MODE2" "$ROUND" "$LOGFILE" &
    PIDS+=($!)
done

echo ""
echo "等待 24 场对战完成..."

FAIL=0
for PID in "${PIDS[@]}"; do
    wait "$PID" || FAIL=$((FAIL + 1))
done

echo ""
echo "=== 循环赛完成 ==="
echo "失败: ${FAIL}"
echo "日志目录: battle_logs/"
ls -la battle_logs/

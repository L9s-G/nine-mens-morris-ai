#!/bin/bash
# 九连棋 AI 对战测试
# 1. Eco vs Master × 2 轮（交替先手，测试不同深度棋力）
# 2. Eco vs Eco × 2 轮（测试随机性）
# 3. Master vs Master × 2 轮（极限压力性能）

cd "$(dirname "$0")"
mkdir -p battle_logs

echo "=== 九连棋 AI 对战测试 ==="
echo ""

# 对战配置：模式1 模式2 轮次
BATTLES=(
    "Eco Master 1"
    "Master Eco 2"
    "Eco Eco 1"
    "Eco Eco 2"
    "Master Master 1"
    "Master Master 2"
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
echo "等待所有对战完成..."

FAIL=0
for PID in "${PIDS[@]}"; do
    wait "$PID" || FAIL=$((FAIL + 1))
done

echo ""
echo "=== 对战测试完成 ==="
echo "日志目录: battle_logs/"
ls -la battle_logs/

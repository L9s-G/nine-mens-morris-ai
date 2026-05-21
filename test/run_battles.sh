#!/bin/bash
# 运行 5 场 Eco vs Eco 对战测试（并行）

mkdir -p battle_logs

echo "=== 开始 Eco 对战测试 ==="
echo "Eco vs Eco | 5 轮"
echo ""

# 存储后台进程 PID
PIDS=()

for ROUND in 1 2 3 4 5; do
    LOGFILE="battle_logs/Eco_vs_Eco_r${ROUND}.log"
    echo "启动: Eco vs Eco 第${ROUND}轮 → ${LOGFILE}"
    node battle.js Eco Eco "$ROUND" "$LOGFILE" &
    PIDS+=($!)
done

echo ""
echo "等待所有对战完成..."

# 等待所有进程完成
FAIL=0
for PID in "${PIDS[@]}"; do
    wait "$PID" || FAIL=$((FAIL + 1))
done

echo ""
echo "=== 对战测试完成 ==="
echo "日志目录: battle_logs/"
ls -la battle_logs/

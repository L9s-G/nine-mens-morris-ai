const fs = require('fs');
const path = require('path');

const logDir = path.resolve(__dirname, 'battle_logs');
const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort();

const SHORT = { Eco: 'E', Normal: 'N', Master: 'M', Demon: 'D' };
const results = [];

for (const file of files) {
    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
    const lines = content.split('\n');

    // 从文件名解析模式: Eco_vs_Normal_r1.log
    const parts = file.replace('.log', '').split('_vs_');
    const mode1 = parts[0];
    const [mode2, round] = parts[1].split('_r');

    // 解析结果
    let winner = '?', totalMoves = 0, totalTime = 0;
    for (const line of lines) {
        if (line.includes('获胜')) winner = line.split('！')[1].replace('获胜', '').trim();
        else if (line.includes('平局')) winner = '平局';
        if (line.includes('总手数:')) totalMoves = parseInt(line.split('总手数: ')[1]);
        if (line.includes('总用时:')) totalTime = parseInt(line.match(/(\d+)ms/)[1]);
    }

    // 解析峰值吞吐量（忽略 <5ms 的短搜索，避免浅层搜索污染数据）
    let maxTP = 0, maxTPMove = 0, moveNum = 0;
    for (const line of lines) {
        if (line.startsWith('--- 第')) moveNum = parseInt(line.match(/第 (\d+) 手/)[1]);
        const t = line.match(/用时: (\d+)ms/);
        const m = line.match(/吞吐: (\d+)n\/ms/);
        if (t && m && parseInt(t[1]) >= 5 && parseInt(m[1]) > maxTP) {
            maxTP = parseInt(m[1]);
            maxTPMove = moveNum;
        }
    }

    const s1 = SHORT[mode1];
    const s2 = SHORT[mode2];
    let result;
    if (winner.includes('平局')) result = '和';
    else if (winner.includes(mode1)) result = `${s1}胜`;
    else result = `${s2}胜`;

    results.push({ label: `${s1}${s2}${round}`, s1, s2, result, totalMoves, totalTime, maxTP, maxTPMove });
}

console.log('');
console.log('| 对局 | 结果 | 手数 | 用时   | 峰值吞吐  | 手#  |');
console.log('|------|------|------|--------|-----------|------|');

for (const r of results) {
    const t = r.totalTime >= 1000 ? `${(r.totalTime / 1000).toFixed(1)}s` : `${r.totalTime}ms`;
    console.log(`| ${r.label.padEnd(5)} | ${r.result} | ${String(r.totalMoves).padStart(3)} | ${t.padStart(6)} | ${String(r.maxTP).padStart(4)}n/ms | #${String(r.maxTPMove).padStart(2)} |`);
}

const modes = ['D', 'M', 'N', 'E'];
console.log('');
console.log('| 模式 | 胜 | 和 | 负 |');
console.log('|------|---|---|---|');
for (const m of modes) {
    const involved = results.filter(r => r.s1 === m || r.s2 === m);
    const w = involved.filter(r => r.result === `${m}胜`).length;
    const d = involved.filter(r => r.result === '和').length;
    const l = involved.length - w - d;
    console.log(`| ${m}    | ${w} | ${d} | ${l} |`);
}

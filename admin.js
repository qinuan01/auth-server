/**
 * Admin CLI tool for managing card keys.
 * Run: node admin.js
 */
const readline = require("readline");
const db = require("./database");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function main() {
    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log("║   Myau 卡密管理工具 (Admin CLI)      ║");
    console.log("╚══════════════════════════════════════╝");
    console.log("");

    let running = true;
    while (running) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("  1. 创建卡密");
        console.log("  2. 列出所有卡密");
        console.log("  3. 查看统计");
        console.log("  4. 封禁卡密");
        console.log("  5. 解封卡密");
        console.log("  6. 删除卡密");
        console.log("  7. 查看日志");
        console.log("  8. 清理过期卡密");
        console.log("  0. 退出");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        const choice = await prompt("请选择操作: ");

        switch (choice.trim()) {
            case "1": {
                const count = await prompt("  生成数量 (默认 1): ");
                const days = await prompt("  有效期天数 (0=永久, 默认 30): ");
                const notes = await prompt("  备注 (可选): ");
                const num = parseInt(count) || 1;
                const dur = parseInt(days) || 30;
                console.log(`\n  正在生成 ${num} 个卡密...`);
                const keys = db.createKeys(num, dur, notes);
                console.log("\n  ── 卡密列表 ──");
                keys.forEach((k, i) => {
                    const expires = dur > 0 ? `${dur}天` : "永久";
                    console.log(`  ${i + 1}. ${k}  (${expires})`);
                });
                console.log("  ──────────────\n");
                break;
            }
            case "2": {
                const keys = db.listKeys();
                console.log(`\n  共 ${keys.length} 个卡密:\n`);
                console.log("  ID  │ 卡密                  │ 状态    │ HWID              │ 天数   │ 创建时间");
                console.log("  ────┼───────────────────────┼─────────┼───────────────────┼────────┼─────────────────────");
                keys.forEach(k => {
                    const hwid = k.hwid ? k.hwid.substring(0, 16) + "..." : "-";
                    const dur = k.duration_days > 0 ? `${k.duration_days}` : "永久";
                    console.log(
                        `  ${String(k.id).padEnd(3)} │ ${k.key.padEnd(22)} │ ${k.status.padEnd(7)} │ ${hwid.padEnd(17)} │ ${dur.padEnd(6)} │ ${k.created_at}`
                    );
                });
                console.log("");
                break;
            }
            case "3": {
                const stats = db.getStats();
                console.log(`\n  ── 卡密统计 ──`);
                console.log(`  总计:     ${stats.total}`);
                console.log(`  未使用:   ${stats.unused}`);
                console.log(`  已激活:   ${stats.active}`);
                console.log(`  已封禁:   ${stats.banned}`);
                console.log(`  已过期:   ${stats.expired}`);
                console.log("  ────────────\n");
                break;
            }
            case "4": {
                const key = await prompt("  输入要封禁的卡密: ");
                if (db.banKey(key.trim().toUpperCase())) {
                    console.log("  ✓ 已封禁\n");
                } else {
                    console.log("  ✗ 卡密不存在\n");
                }
                break;
            }
            case "5": {
                const key = await prompt("  输入要解封的卡密: ");
                if (db.unbanKey(key.trim().toUpperCase())) {
                    console.log("  ✓ 已解封\n");
                } else {
                    console.log("  ✗ 卡密不存在或未被封禁\n");
                }
                break;
            }
            case "6": {
                const key = await prompt("  输入要删除的卡密: ");
                const confirm = await prompt(`  确认删除 ${key}? (y/N): `);
                if (confirm.toLowerCase() === "y") {
                    if (db.deleteKey(key.trim().toUpperCase())) {
                        console.log("  ✓ 已删除\n");
                    } else {
                        console.log("  ✗ 卡密不存在\n");
                    }
                } else {
                    console.log("  已取消\n");
                }
                break;
            }
            case "7": {
                const limit = await prompt("  显示条数 (默认 50): ");
                const logs = db.getLogs(parseInt(limit) || 50);
                console.log(`\n  最近 ${logs.length} 条日志:\n`);
                console.log("  时间                    │ 卡密                  │ 操作      │ 消息");
                console.log("  ────────────────────────┼───────────────────────┼───────────┼──────────────────────");
                logs.forEach(l => {
                    const keyShort = l.key ? l.key.substring(0, 22) : "-";
                    console.log(
                        `  ${l.created_at.padEnd(23)} │ ${keyShort.padEnd(22)} │ ${l.action.padEnd(9)} │ ${(l.message || "").substring(0, 30)}`
                    );
                });
                console.log("");
                break;
            }
            case "8": {
                const count = db.cleanupExpired();
                console.log(`  已清理过期卡密\n`);
                break;
            }
            case "0": {
                running = false;
                break;
            }
            default:
                console.log("  无效选项，请重新选择\n");
        }
    }

    rl.close();
    process.exit(0);
}

main().catch(console.error);

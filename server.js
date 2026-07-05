const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 13483;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "myau_admin_2024";

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (admin panel)
app.use(express.static(path.join(__dirname, "public")));

// ===== Auth API (client-facing) =====

app.post("/api/auth", (req, res) => {
    const { cardKey, hwid } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    if (!cardKey || !hwid) {
        return res.json({ success: false, message: "缺少参数 (cardKey, hwid)" });
    }
    if (cardKey.length < 10 || hwid.length < 10) {
        return res.json({ success: false, message: "参数格式不正确" });
    }

    const result = db.validateCardKey(cardKey.toUpperCase(), hwid, ip);

    if (Math.random() < 0.02) {
        db.cleanupExpired();
    }

    res.json(result);
});

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ===== Admin Login (username/password) =====

app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "请输入用户名和密码" });
    }

    const user = db.verifyUser(username, password);
    if (user) {
        res.json({
            success: true,
            message: "登录成功",
            token: ADMIN_TOKEN,
            user: { username: user.username, role: user.role }
        });
    } else {
        res.json({ success: false, message: "用户名或密码错误" });
    }
});

// ===== Admin API (token-protected) =====

function requireAdmin(req, res, next) {
    const token = req.headers["authorization"];
    if (!token || token !== `Bearer ${ADMIN_TOKEN}`) {
        return res.status(401).json({ error: "未授权" });
    }
    next();
}

app.post("/api/admin/keys", requireAdmin, (req, res) => {
    const count = parseInt(req.body.count) || 1;
    const duration = parseInt(req.body.duration) || 30;
    const notes = req.body.notes || "";

    if (count < 1 || count > 100) {
        return res.status(400).json({ error: "数量必须在 1-100 之间" });
    }

    const keys = db.createKeys(count, duration, notes);
    res.json({ success: true, count: keys.length, keys });
});

app.post("/api/admin/batch-import", requireAdmin, (req, res) => {
    const { keys, duration } = req.body;
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ error: "请提供卡密列表" });
    }
    const dur = parseInt(duration) || 30;
    const insert = db.getDb().prepare(
        "INSERT OR IGNORE INTO card_keys (key, duration_days) VALUES (?, ?)"
    );
    let count = 0;
    const transaction = db.getDb().transaction(() => {
        for (const k of keys) {
            const key = k.trim().toUpperCase();
            if (key.length >= 10) {
                const info = insert.run(key, dur);
                if (info.changes > 0) count++;
            }
        }
    });
    transaction();
    res.json({ success: true, count, message: `成功导入 ${count} 个卡密` });
});

app.get("/api/admin/keys", requireAdmin, (req, res) => {
    const keys = db.listKeys();
    res.json({ success: true, count: keys.length, keys });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
    const stats = db.getStats();
    res.json({ success: true, stats });
});

app.post("/api/admin/ban", requireAdmin, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "缺少key参数" });
    const ok = db.banKey(key);
    res.json({ success: ok, message: ok ? "已封禁" : "卡密不存在" });
});

app.post("/api/admin/unban", requireAdmin, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "缺少key参数" });
    const ok = db.unbanKey(key);
    res.json({ success: ok, message: ok ? "已解封" : "卡密不存在或未被封禁" });
});

app.delete("/api/admin/keys", requireAdmin, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "缺少key参数" });
    const ok = db.deleteKey(key);
    res.json({ success: ok, message: ok ? "已删除" : "卡密不存在" });
});

app.get("/api/admin/logs", requireAdmin, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const logs = db.getLogs(limit);
    res.json({ success: true, count: logs.length, logs });
});

// Redirect root to admin page
app.get("/", (req, res) => {
    res.redirect("/admin.html");
});

// ===== Start Server =====

app.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log("  Myau 卡密管理服务器已启动");
    console.log("========================================");
    console.log(`  管理后台: http://localhost:${PORT}`);
    console.log("  默认账号: qinuan / a321654");
    console.log(`  Admin密钥: ${ADMIN_TOKEN}`);
    console.log("  数据库:    data/myau_auth.db");
    console.log("========================================");
    console.log("  API 端点:");
    console.log("  POST /api/auth        - 客户端验证");
    console.log("  GET  /api/health      - 健康检查");
    console.log("  POST /api/admin/login - 管理员登录");
    console.log("  POST /api/admin/keys  - 创建卡密");
    console.log("  GET  /api/admin/keys  - 列出卡密");
    console.log("  GET  /api/admin/stats - 统计信息");
    console.log("  POST /api/admin/ban   - 封禁卡密");
    console.log("  POST /api/admin/unban - 解封卡密");
    console.log("  DELETE /api/admin/keys - 删除卡密");
    console.log("  GET  /api/admin/logs  - 验证日志");
    console.log("========================================");

    db.cleanupExpired();
});

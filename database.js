const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data", "myau_auth.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma("journal_mode = WAL");
        initTables();
    }
    return db;
}

function initTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_keys (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            key          TEXT NOT NULL UNIQUE,
            hwid         TEXT,
            status       TEXT NOT NULL DEFAULT 'unused'
                         CHECK(status IN ('unused', 'active', 'banned', 'expired')),
            duration_days INTEGER NOT NULL DEFAULT 0,
            notes        TEXT DEFAULT '',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            activated_at TEXT,
            expires_at   TEXT,
            last_seen    TEXT
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_logs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            key       TEXT NOT NULL,
            hwid      TEXT,
            ip        TEXT,
            action    TEXT NOT NULL,
            message   TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // Users table for admin login
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            username  TEXT NOT NULL UNIQUE,
            password  TEXT NOT NULL,
            role      TEXT NOT NULL DEFAULT 'admin',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // Create indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_keys_key ON card_keys(key);
        CREATE INDEX IF NOT EXISTS idx_keys_hwid ON card_keys(hwid);
        CREATE INDEX IF NOT EXISTS idx_logs_key ON auth_logs(key);
    `);

    seedDefaultUser();
}

function seedDefaultUser() {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get("qinuan");
    if (!existing) {
        const hash = crypto.createHash("sha256").update("a321654").digest("hex");
        db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run("qinuan", hash);
        console.log("[Init] Default admin user 'qinuan' created");
    }
}

function verifyUser(username, password) {
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    const user = db.prepare("SELECT id, username, role FROM users WHERE username = ? AND password = ?").get(username, hash);
    return user || null;
}

// ===== Card Key Functions =====

function createKeys(count, durationDays, notes = "") {
    const insert = getDb().prepare(
        "INSERT INTO card_keys (key, duration_days, notes) VALUES (?, ?, ?)"
    );
    const keys = [];
    const transaction = getDb().transaction(() => {
        for (let i = 0; i < count; i++) {
            const key = generateKey();
            insert.run(key, durationDays, notes);
            keys.push(key);
        }
    });
    transaction();
    return keys;
}

function generateKey() {
    const { v4: uuidv4 } = require("uuid");
    const raw = uuidv4().replace(/-/g, "").toUpperCase();
    return raw.substring(0, 5) + "-" + raw.substring(5, 10) + "-" +
           raw.substring(10, 15) + "-" + raw.substring(15, 20);
}

function validateCardKey(cardKey, hwid, ip) {
    const row = getDb().prepare("SELECT * FROM card_keys WHERE key = ?").get(cardKey);

    if (!row) {
        logAuth(cardKey, hwid, ip, "reject", "卡密不存在");
        return { success: false, message: "卡密不存在" };
    }
    if (row.status === "banned") {
        logAuth(cardKey, hwid, ip, "reject", "卡密已被封禁");
        return { success: false, message: "卡密已被封禁" };
    }
    if (row.status === "expired") {
        logAuth(cardKey, hwid, ip, "reject", "卡密已过期");
        return { success: false, message: "卡密已过期" };
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        getDb().prepare("UPDATE card_keys SET status = 'expired' WHERE key = ?").run(cardKey);
        logAuth(cardKey, hwid, ip, "reject", "卡密已过期");
        return { success: false, message: "卡密已过期" };
    }
    if (row.status === "unused") {
        const expiresAt = row.duration_days > 0
            ? new Date(Date.now() + row.duration_days * 86400000).toISOString()
            : null;
        getDb().prepare(`
            UPDATE card_keys SET
                status = 'active',
                hwid = ?,
                activated_at = datetime('now'),
                expires_at = ?,
                last_seen = datetime('now')
            WHERE key = ?
        `).run(hwid, expiresAt, cardKey);
        logAuth(cardKey, hwid, ip, "activate", "首次激活，绑定HWID成功");
        return { success: true, message: "激活成功！卡密已绑定此设备" };
    }
    if (row.status === "active") {
        if (row.hwid === hwid) {
            getDb().prepare("UPDATE card_keys SET last_seen = datetime('now') WHERE key = ?").run(cardKey);
            logAuth(cardKey, hwid, ip, "verify", "HWID匹配，验证通过");
            return { success: true, message: "验证通过" };
        } else {
            logAuth(cardKey, hwid, ip, "reject", "HWID不匹配 - 此卡密已绑定其他设备");
            return { success: false, message: "此卡密已绑定其他设备，请联系管理员", code: "HWID_MISMATCH" };
        }
    }
    logAuth(cardKey, hwid, ip, "reject", "未知状态: " + row.status);
    return { success: false, message: "卡密状态异常" };
}

function listKeys() {
    return getDb().prepare("SELECT * FROM card_keys ORDER BY created_at DESC").all();
}

function banKey(cardKey) {
    const info = getDb().prepare("UPDATE card_keys SET status = 'banned' WHERE key = ?").run(cardKey);
    return info.changes > 0;
}

function unbanKey(cardKey) {
    const info = getDb().prepare("UPDATE card_keys SET status = 'active' WHERE key = ? AND status = 'banned'").run(cardKey);
    return info.changes > 0;
}

function deleteKey(cardKey) {
    const info = getDb().prepare("DELETE FROM card_keys WHERE key = ?").run(cardKey);
    return info.changes > 0;
}

function getStats() {
    return getDb().prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) as unused,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) as banned,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
        FROM card_keys
    `).get();
}

// ===== Logging =====

function logAuth(key, hwid, ip, action, message) {
    getDb().prepare(`
        INSERT INTO auth_logs (key, hwid, ip, action, message)
        VALUES (?, ?, ?, ?, ?)
    `).run(key, hwid || null, ip || null, action, message);
}

function getLogs(limit = 100) {
    return getDb().prepare("SELECT * FROM auth_logs ORDER BY created_at DESC LIMIT ?").all(limit);
}

// ===== Cleanup =====

function cleanupExpired() {
    const info = getDb().prepare(`
        UPDATE card_keys SET status = 'expired'
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
    if (info.changes > 0) {
        console.log(`[Cleanup] Expired ${info.changes} card keys`);
    }
}

module.exports = {
    getDb,
    verifyUser,
    createKeys,
    validateCardKey,
    listKeys,
    banKey,
    unbanKey,
    deleteKey,
    getStats,
    getLogs,
    cleanupExpired
};

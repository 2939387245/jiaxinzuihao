import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const password = String(process.env.OWNER_PASSWORD || "");
const name = String(process.env.OWNER_NAME || "").trim();

if (!email || !email.includes("@")) throw new Error("请通过 OWNER_EMAIL 提供正确的邮箱");
if (password.length < 8 || password.length > 72) throw new Error("OWNER_PASSWORD 必须为 8–72 位");
if (!name || name.length > 20) throw new Error("OWNER_NAME 必须为 1–20 个字符");

fs.mkdirSync(dataDir, { recursive: true });
const databasePath = path.join(dataDir, "lumi.sqlite");
const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

try {
  const hasUsersTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!hasUsersTable) throw new Error("请先启动一次后端以创建数据库结构，再运行初始化命令");
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count) throw new Error("数据库里已经有账号；为避免误删数据，初始化已取消");

  const createdAt = new Date().toISOString();
  const spaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const code = crypto.randomBytes(9).toString("base64url").toUpperCase();
  const passwordHash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    db.prepare("INSERT INTO spaces (id, invite_code, title, together_since, created_at, invite_used_at) VALUES (?, ?, ?, ?, ?, NULL)")
      .run(spaceId, code, `${name}的双人空间`, createdAt.slice(0, 10), createdAt);
    db.prepare("INSERT INTO users (id, email, name, password_hash, avatar_color, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(userId, email, name, passwordHash, "#bb6bd9", spaceId, createdAt);
  })();
  console.log(`首个账号已创建。一次性邀请码：${code}`);
} finally {
  db.close();
}

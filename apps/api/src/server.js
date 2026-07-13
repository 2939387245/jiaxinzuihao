import "dotenv/config";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Server } from "socket.io";
import { z } from "zod";
import { prepareMomentMedia } from "./motion-photo.js";

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_JWT_SECRET = "local-only-change-before-deploy";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const MEDIA_URL_TTL_SECONDS = Number(process.env.MEDIA_URL_TTL_SECONDS || 900);
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
if (process.env.NODE_ENV === "production" && (JWT_SECRET === DEFAULT_JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32)) {
  throw new Error("生产环境必须设置至少 32 字节的 JWT_SECRET");
}
const origins = (process.env.CLIENT_ORIGIN || "http://localhost:4173,http://localhost:5173")
  .split(",")
  .map((item) => item.trim());
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "lumi.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    invite_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '我们的空间',
    together_since TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    avatar_color TEXT NOT NULL,
    space_id TEXT NOT NULL REFERENCES spaces(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS moments (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    video_url TEXT NOT NULL DEFAULT '',
    happened_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS anniversaries (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id),
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    repeat_yearly INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '想一起做',
    completed INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS space_settings (
    space_id TEXT PRIMARY KEY REFERENCES spaces(id),
    deepseek_api_key TEXT NOT NULL DEFAULT '',
    deepseek_model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    updated_at TEXT NOT NULL
  );
`);
const spaceColumns = db.pragma("table_info(spaces)");
if (!spaceColumns.some((column) => column.name === "invite_used_at")) {
  db.exec("ALTER TABLE spaces ADD COLUMN invite_used_at TEXT");
}
const userColumns = db.pragma("table_info(users)");
if (!userColumns.some((column) => column.name === "token_version")) {
  db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
}
const momentColumns = db.pragma("table_info(moments)");
if (!momentColumns.some((column) => column.name === "video_url")) {
  db.exec("ALTER TABLE moments ADD COLUMN video_url TEXT NOT NULL DEFAULT ''");
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const inviteCode = () => {
  let code;
  do code = crypto.randomBytes(9).toString("base64url").toUpperCase();
  while (db.prepare("SELECT 1 FROM spaces WHERE invite_code = ?").get(code));
  return code;
};
const signToken = (user) => jwt.sign({ sub: user.id, spaceId: user.space_id, version: user.token_version || 0 }, JWT_SECRET, { expiresIn: "30d" });
const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarColor: user.avatar_color,
});

const secretKey = crypto.createHash("sha256").update(JWT_SECRET).digest();
function encryptSecret(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptSecret(value) {
  if (!value) return "";
  try {
    const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function removeUploadedMedia(mediaUrl) {
  if (!mediaUrl?.startsWith("/uploads/")) return;
  fs.rmSync(path.join(uploadDir, path.basename(mediaUrl)), { force: true });
}

function privateMediaUrl(mediaUrl, spaceId) {
  if (!mediaUrl?.startsWith("/uploads/")) return mediaUrl;
  const filename = path.basename(mediaUrl);
  const token = jwt.sign({ scope: "media", filename, spaceId }, JWT_SECRET, { expiresIn: MEDIA_URL_TTL_SECONDS });
  return `/api/media/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
}

function serializeMoment(moment) {
  if (!moment) return moment;
  return {
    ...moment,
    image_url: privateMediaUrl(moment.image_url, moment.space_id),
    video_url: privateMediaUrl(moment.video_url, moment.space_id),
  };
}

function deepSeekSettings(spaceId) {
  const row = db.prepare("SELECT * FROM space_settings WHERE space_id = ?").get(spaceId);
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || decryptSecret(row?.deepseek_api_key),
    model: row?.deepseek_model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    managedByEnv: Boolean(process.env.DEEPSEEK_API_KEY),
  };
}

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: origins, credentials: true } });
app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const rateBuckets = new Map();
function consumeRateLimit(key, limit, windowMs) {
  const timestamp = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= timestamp) bucket = { count: 0, resetAt: timestamp + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000)) };
}

function loginRateLimit(req, res, next) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const checks = [
    consumeRateLimit(`login-ip:${req.ip}`, 30, 15 * 60 * 1000),
    consumeRateLimit(`login-email:${email || "unknown"}`, 10, 15 * 60 * 1000),
  ];
  const blocked = checks.find((check) => !check.allowed);
  if (!blocked) return next();
  res.set("Retry-After", String(blocked.retryAfter));
  return res.status(429).json({ error: "登录尝试过于频繁，请稍后再试" });
}

function registerRateLimit(req, res, next) {
  const check = consumeRateLimit(`register-ip:${req.ip}`, 8, 60 * 60 * 1000);
  if (check.allowed) return next();
  res.set("Retry-After", String(check.retryAfter));
  return res.status(429).json({ error: "注册尝试过于频繁，请稍后再试" });
}

function passwordRateLimit(req, res, next) {
  const check = consumeRateLimit(`password-user:${req.user.id}`, 5, 15 * 60 * 1000);
  if (check.allowed) return next();
  res.set("Retry-After", String(check.retryAfter));
  return res.status(429).json({ error: "修改密码尝试过于频繁，请稍后再试" });
}

setInterval(() => {
  const timestamp = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= timestamp) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp", "image/heic"].includes(file.mimetype)) return cb(null, true);
    const extension = path.extname(file.originalname).toLowerCase();
    if (file.mimetype === "application/octet-stream" && [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(extension)) return cb(null, true);
    const error = new Error("只支持 JPG、PNG、WebP、HEIC 和动态 JPG");
    error.status = 400;
    return cb(error);
  },
});

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user || Number(payload.version || 0) !== user.token_version) throw new Error("missing or outdated user");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "登录状态已失效，请重新登录" });
  }
}

function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "提交内容不完整");
    error.status = 400;
    throw error;
  }
  return result.data;
}

function emitUpdate(spaceId, resource) {
  io.to(`space:${spaceId}`).emit("space:updated", { resource, at: now() });
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "lumi-api" }));

app.get("/api/media/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename) throw new Error("invalid filename");
    const payload = jwt.verify(String(req.query.token || ""), JWT_SECRET);
    if (payload.scope !== "media" || payload.filename !== filename || !payload.spaceId) throw new Error("invalid media token");
    const storedPath = `/uploads/${filename}`;
    const belongsToSpace = db.prepare("SELECT 1 FROM moments WHERE space_id = ? AND (image_url = ? OR video_url = ?)").get(payload.spaceId, storedPath, storedPath);
    if (!belongsToSpace) return res.status(404).json({ error: "没有找到这个媒体文件" });
    const absolutePath = path.resolve(uploadDir, filename);
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "媒体文件不存在" });
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(filename, { root: uploadDir });
  } catch {
    return res.status(401).json({ error: "媒体访问链接已失效，请刷新页面" });
  }
});

app.post("/api/auth/login", loginRateLimit, async (req, res, next) => {
  try {
    const input = validate(z.object({ email: z.string().email("请输入正确的邮箱"), password: z.string().min(6, "密码至少 6 位") }), req.body);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(input.email.toLowerCase());
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return res.status(401).json({ error: "邮箱或密码不正确" });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/register", registerRateLimit, async (req, res, next) => {
  try {
    const input = validate(z.object({
      name: z.string().trim().min(1, "请填写昵称").max(20),
      email: z.string().email("请输入正确的邮箱"),
      password: z.string().min(6, "密码至少 6 位").max(72),
      inviteCode: z.string().trim().min(8, "请输入完整的邀请码").max(20),
    }), req.body);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(input.email.toLowerCase())) {
      return res.status(409).json({ error: "这个邮箱已经注册" });
    }
    const availableSpace = db.prepare("SELECT id FROM spaces WHERE invite_code = ? AND invite_used_at IS NULL").get(input.inviteCode.toUpperCase());
    if (!availableSpace) return res.status(404).json({ error: "邀请码不存在或已经使用" });
    const user = {
      id: id(), email: input.email.toLowerCase(), name: input.name,
      password_hash: await bcrypt.hash(input.password, 12), avatar_color: "#e16497", created_at: now(),
    };
    const space = db.transaction(() => {
      const matchedSpace = db.prepare("SELECT * FROM spaces WHERE invite_code = ? AND invite_used_at IS NULL").get(input.inviteCode.toUpperCase());
      if (!matchedSpace) throw Object.assign(new Error("邀请码不存在或已经使用"), { status: 404 });
      const count = db.prepare("SELECT COUNT(*) AS count FROM users WHERE space_id = ?").get(matchedSpace.id).count;
      if (count !== 1) throw Object.assign(new Error(count >= 2 ? "这个空间已经有两个人了" : "这个邀请码暂时不能使用"), { status: 409 });
      user.space_id = matchedSpace.id;
      db.prepare("INSERT INTO users (id, email, name, password_hash, avatar_color, space_id, created_at) VALUES (@id, @email, @name, @password_hash, @avatar_color, @space_id, @created_at)").run(user);
      const consumed = db.prepare("UPDATE spaces SET invite_used_at = ? WHERE id = ? AND invite_used_at IS NULL").run(now(), matchedSpace.id);
      if (!consumed.changes) throw Object.assign(new Error("邀请码已经使用"), { status: 409 });
      return matchedSpace;
    })();
    emitUpdate(space.id, "members");
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
});

app.get("/api/me", auth, (req, res) => {
  const space = db.prepare("SELECT * FROM spaces WHERE id = ?").get(req.user.space_id);
  const members = db.prepare("SELECT * FROM users WHERE space_id = ? ORDER BY created_at").all(req.user.space_id).map(publicUser);
  const paired = members.length >= 2;
  res.json({ user: publicUser(req.user), members, space: { id: space.id, title: space.title, inviteCode: !paired && !space.invite_used_at ? space.invite_code : "", paired, togetherSince: space.together_since } });
});

app.post("/api/space/invite", auth, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users WHERE space_id = ?").get(req.user.space_id).count;
  if (count >= 2) return res.status(409).json({ error: "双人空间已经完成配对" });
  const code = inviteCode();
  db.prepare("UPDATE spaces SET invite_code = ?, invite_used_at = NULL WHERE id = ?").run(code, req.user.space_id);
  emitUpdate(req.user.space_id, "space");
  res.json({ inviteCode: code });
});

app.patch("/api/space", auth, (req, res, next) => {
  try {
    const input = validate(z.object({ title: z.string().trim().min(1).max(40).optional(), togetherSince: z.string().date().optional() }), req.body);
    const current = db.prepare("SELECT * FROM spaces WHERE id = ?").get(req.user.space_id);
    db.prepare("UPDATE spaces SET title = ?, together_since = ? WHERE id = ?")
      .run(input.title ?? current.title, input.togetherSince ?? current.together_since, current.id);
    emitUpdate(current.id, "space");
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/dashboard", auth, (req, res) => {
  const space = db.prepare("SELECT * FROM spaces WHERE id = ?").get(req.user.space_id);
  const counts = {
    moments: db.prepare("SELECT COUNT(*) AS count FROM moments WHERE space_id = ?").get(space.id).count,
    todos: db.prepare("SELECT COUNT(*) AS count FROM todos WHERE space_id = ? AND completed = 0").get(space.id).count,
    anniversaries: db.prepare("SELECT COUNT(*) AS count FROM anniversaries WHERE space_id = ?").get(space.id).count,
  };
  const latestMoment = db.prepare("SELECT * FROM moments WHERE space_id = ? ORDER BY happened_at DESC LIMIT 1").get(space.id) || null;
  const latestMessage = db.prepare(`SELECT messages.*, users.name AS sender_name FROM messages JOIN users ON users.id = messages.sender_id WHERE messages.space_id = ? ORDER BY messages.created_at DESC LIMIT 1`).get(space.id) || null;
  res.json({ space: { title: space.title, togetherSince: space.together_since }, counts, latestMoment: serializeMoment(latestMoment), latestMessage });
});

app.get("/api/moments", auth, (req, res) => {
  const rows = db.prepare(`SELECT moments.*, users.name AS author_name FROM moments JOIN users ON users.id = moments.author_id WHERE moments.space_id = ? ORDER BY happened_at DESC, created_at DESC`).all(req.user.space_id);
  res.json(rows.map(serializeMoment));
});

app.post("/api/moments", auth, upload.single("image"), async (req, res, next) => {
  let prepared = null;
  let saved = false;
  try {
    const input = validate(z.object({ title: z.string().trim().min(1).max(60), note: z.string().max(400).optional(), happenedAt: z.string().date() }), req.body);
    prepared = req.file ? await prepareMomentMedia(req.file, { uploadDir, ffmpegPath: FFMPEG_PATH }) : null;
    const row = {
      id: id(),
      space_id: req.user.space_id,
      author_id: req.user.id,
      title: input.title,
      note: input.note || "",
      image_url: prepared?.imageUrl || "",
      video_url: prepared?.videoUrl || "",
      happened_at: input.happenedAt,
      created_at: now(),
    };
    db.prepare("INSERT INTO moments (id, space_id, author_id, title, note, image_url, video_url, happened_at, created_at) VALUES (@id, @space_id, @author_id, @title, @note, @image_url, @video_url, @happened_at, @created_at)").run(row);
    saved = true;
    emitUpdate(req.user.space_id, "moments");
    res.status(201).json(serializeMoment(row));
  } catch (error) {
    if (!saved && req.file) fs.rmSync(req.file.path, { force: true });
    if (!saved) removeUploadedMedia(prepared?.videoUrl);
    next(error);
  }
});

app.patch("/api/moments/:id", auth, upload.single("image"), async (req, res, next) => {
  let replacement = null;
  let saved = false;
  try {
    const current = db.prepare("SELECT * FROM moments WHERE id = ? AND space_id = ?").get(req.params.id, req.user.space_id);
    if (!current) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(404).json({ error: "没有找到这段时光" });
    }
    const input = validate(z.object({
      title: z.string().trim().min(1).max(60),
      note: z.string().max(400).optional(),
      happenedAt: z.string().date(),
      removeImage: z.enum(["true", "false"]).optional(),
    }), req.body);
    let imageUrl = current.image_url;
    let videoUrl = current.video_url;
    if (req.file) {
      replacement = await prepareMomentMedia(req.file, { uploadDir, ffmpegPath: FFMPEG_PATH });
      imageUrl = replacement.imageUrl;
      videoUrl = replacement.videoUrl;
    } else if (input.removeImage === "true") {
      imageUrl = "";
      videoUrl = "";
    }
    db.prepare("UPDATE moments SET title = ?, note = ?, happened_at = ?, image_url = ?, video_url = ? WHERE id = ?")
      .run(input.title, input.note || "", input.happenedAt, imageUrl, videoUrl, current.id);
    saved = true;
    if (req.file || input.removeImage === "true") {
      removeUploadedMedia(current.image_url);
      removeUploadedMedia(current.video_url);
    }
    emitUpdate(req.user.space_id, "moments");
    res.json(serializeMoment({ ...current, title: input.title, note: input.note || "", happened_at: input.happenedAt, image_url: imageUrl, video_url: videoUrl }));
  } catch (error) {
    if (!saved && req.file) fs.rmSync(req.file.path, { force: true });
    if (!saved) removeUploadedMedia(replacement?.videoUrl);
    next(error);
  }
});

app.delete("/api/moments/:id", auth, (req, res) => {
  const current = db.prepare("SELECT * FROM moments WHERE id = ? AND space_id = ?").get(req.params.id, req.user.space_id);
  if (!current) return res.status(404).json({ error: "没有找到这段时光" });
  db.prepare("DELETE FROM moments WHERE id = ?").run(current.id);
  removeUploadedMedia(current.image_url);
  removeUploadedMedia(current.video_url);
  emitUpdate(req.user.space_id, "moments");
  res.json({ ok: true });
});

app.get("/api/anniversaries", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM anniversaries WHERE space_id = ? ORDER BY event_date").all(req.user.space_id));
});

app.post("/api/anniversaries", auth, (req, res, next) => {
  try {
    const input = validate(z.object({ title: z.string().trim().min(1).max(50), eventDate: z.string().date(), repeatYearly: z.boolean().optional(), note: z.string().max(200).optional() }), req.body);
    const row = { id: id(), space_id: req.user.space_id, title: input.title, event_date: input.eventDate, repeat_yearly: input.repeatYearly === false ? 0 : 1, note: input.note || "", created_at: now() };
    db.prepare("INSERT INTO anniversaries (id, space_id, title, event_date, repeat_yearly, note, created_at) VALUES (@id, @space_id, @title, @event_date, @repeat_yearly, @note, @created_at)").run(row);
    emitUpdate(req.user.space_id, "anniversaries");
    res.status(201).json(row);
  } catch (error) { next(error); }
});

app.patch("/api/anniversaries/:id", auth, (req, res, next) => {
  try {
    const current = db.prepare("SELECT * FROM anniversaries WHERE id = ? AND space_id = ?").get(req.params.id, req.user.space_id);
    if (!current) return res.status(404).json({ error: "没有找到这个纪念日" });
    const input = validate(z.object({
      title: z.string().trim().min(1).max(50),
      eventDate: z.string().date(),
      repeatYearly: z.boolean(),
      note: z.string().max(200).optional(),
    }), req.body);
    db.prepare("UPDATE anniversaries SET title = ?, event_date = ?, repeat_yearly = ?, note = ? WHERE id = ?")
      .run(input.title, input.eventDate, input.repeatYearly ? 1 : 0, input.note || "", current.id);
    emitUpdate(req.user.space_id, "anniversaries");
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete("/api/anniversaries/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM anniversaries WHERE id = ? AND space_id = ?").run(req.params.id, req.user.space_id);
  if (!result.changes) return res.status(404).json({ error: "没有找到这个纪念日" });
  emitUpdate(req.user.space_id, "anniversaries");
  res.json({ ok: true });
});

app.get("/api/todos", auth, (req, res) => {
  res.json(db.prepare(`SELECT todos.*, users.name AS creator_name FROM todos JOIN users ON users.id = todos.created_by WHERE todos.space_id = ? ORDER BY completed, created_at DESC`).all(req.user.space_id));
});

app.post("/api/todos", auth, (req, res, next) => {
  try {
    const input = validate(z.object({ title: z.string().trim().min(1).max(100), category: z.string().trim().max(30).optional() }), req.body);
    const row = { id: id(), space_id: req.user.space_id, title: input.title, category: input.category || "想一起做", completed: 0, created_by: req.user.id, created_at: now() };
    db.prepare("INSERT INTO todos (id, space_id, title, category, completed, created_by, created_at) VALUES (@id, @space_id, @title, @category, @completed, @created_by, @created_at)").run(row);
    emitUpdate(req.user.space_id, "todos");
    res.status(201).json(row);
  } catch (error) { next(error); }
});

app.patch("/api/todos/:id", auth, (req, res) => {
  const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND space_id = ?").get(req.params.id, req.user.space_id);
  if (!todo) return res.status(404).json({ error: "没有找到这条清单" });
  const input = validate(z.object({
    completed: z.boolean().optional(),
    title: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(30).optional(),
  }), req.body);
  db.prepare("UPDATE todos SET completed = ?, title = ?, category = ? WHERE id = ?")
    .run(input.completed === undefined ? todo.completed : input.completed ? 1 : 0, input.title ?? todo.title, input.category ?? todo.category, todo.id);
  emitUpdate(req.user.space_id, "todos");
  res.json({ ok: true });
});

app.delete("/api/todos/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM todos WHERE id = ? AND space_id = ?").run(req.params.id, req.user.space_id);
  if (!result.changes) return res.status(404).json({ error: "没有找到这条清单" });
  emitUpdate(req.user.space_id, "todos");
  res.json({ ok: true });
});

app.get("/api/messages", auth, (req, res) => {
  const rows = db.prepare(`SELECT messages.*, users.name AS sender_name, users.avatar_color FROM messages JOIN users ON users.id = messages.sender_id WHERE messages.space_id = ? ORDER BY messages.created_at ASC LIMIT 200`).all(req.user.space_id);
  res.json(rows);
});

app.post("/api/messages", auth, (req, res, next) => {
  try {
    const input = validate(z.object({ body: z.string().trim().min(1).max(1000) }), req.body);
    const row = { id: id(), space_id: req.user.space_id, sender_id: req.user.id, body: input.body, created_at: now(), sender_name: req.user.name, avatar_color: req.user.avatar_color };
    db.prepare("INSERT INTO messages (id, space_id, sender_id, body, created_at) VALUES (@id, @space_id, @sender_id, @body, @created_at)").run(row);
    io.to(`space:${req.user.space_id}`).emit("message:new", row);
    res.status(201).json(row);
  } catch (error) { next(error); }
});

app.get("/api/settings/ai", auth, (req, res) => {
  const settings = deepSeekSettings(req.user.space_id);
  res.json({
    configured: Boolean(settings.apiKey),
    managedByEnv: settings.managedByEnv,
    maskedKey: settings.apiKey ? `${settings.apiKey.slice(0, 3)}••••${settings.apiKey.slice(-4)}` : "",
    model: settings.model,
  });
});

app.put("/api/settings/ai", auth, (req, res, next) => {
  try {
    const input = validate(z.object({
      apiKey: z.string().trim().max(500).optional(),
      model: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]),
      clearApiKey: z.boolean().optional(),
    }), req.body);
    const current = db.prepare("SELECT * FROM space_settings WHERE space_id = ?").get(req.user.space_id);
    let encryptedKey = current?.deepseek_api_key || "";
    if (input.clearApiKey) encryptedKey = "";
    else if (input.apiKey) encryptedKey = encryptSecret(input.apiKey);
    db.prepare(`
      INSERT INTO space_settings (space_id, deepseek_api_key, deepseek_model, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        deepseek_api_key = excluded.deepseek_api_key,
        deepseek_model = excluded.deepseek_model,
        updated_at = excluded.updated_at
    `).run(req.user.space_id, encryptedKey, input.model, now());
    const settings = deepSeekSettings(req.user.space_id);
    res.json({ configured: Boolean(settings.apiKey), managedByEnv: settings.managedByEnv, model: settings.model });
  } catch (error) { next(error); }
});

app.post("/api/ai/date-plan", auth, async (req, res, next) => {
  try {
    const input = validate(z.object({
      city: z.string().trim().min(1).max(40),
      budget: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1).max(30)),
      mood: z.string().trim().min(1).max(300),
      date: z.union([z.string().date(), z.literal("")]).optional(),
    }), req.body);
    const settings = deepSeekSettings(req.user.space_id);
    if (!settings.apiKey) return res.status(409).json({ error: "请先在约会灵感右上角设置 DeepSeek API Key", code: "AI_NOT_CONFIGURED" });

    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 1400,
        messages: [
          {
            role: "system",
            content: "你是情侣约会策划助手。只输出合法 JSON，不要 Markdown。计划要现实、温柔、可执行，尊重预算，不虚构营业时间。JSON 格式必须为：{\"title\":\"标题\",\"summary\":\"一句话简介\",\"estimatedCost\":\"预计总花费\",\"steps\":[{\"time\":\"15:00\",\"title\":\"环节标题\",\"detail\":\"具体建议\",\"cost\":\"预计花费\"}],\"tips\":[\"提醒\"]}",
          },
          {
            role: "user",
            content: `请为两个人生成约会计划。城市：${input.city}；预算：${input.budget} 元；想要的感觉：${input.mood}；日期：${input.date || "未指定"}。请用中文输出 JSON。`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstreamMessage = payload?.error?.message || "DeepSeek 服务请求失败";
      const error = new Error(upstreamMessage);
      error.status = response.status === 401 ? 400 : 502;
      throw error;
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw Object.assign(new Error("DeepSeek 没有返回计划，请稍后再试"), { status: 502 });
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
    const plan = validate(z.object({
      title: z.string().min(1).max(100),
      summary: z.string().min(1).max(300),
      estimatedCost: z.union([z.string(), z.number()]).transform(String),
      steps: z.array(z.object({
        time: z.string().max(20),
        title: z.string().min(1).max(100),
        detail: z.string().min(1).max(500),
        cost: z.union([z.string(), z.number()]).transform(String),
      })).min(2).max(10),
      tips: z.array(z.string().max(200)).max(6).default([]),
    }), parsed);
    res.json({ plan, model: settings.model, usage: payload.usage || null });
  } catch (error) {
    if (error.name === "TimeoutError") error = Object.assign(new Error("DeepSeek 响应超时，请稍后再试"), { status: 504 });
    next(error);
  }
});

app.put("/api/account/password", auth, passwordRateLimit, async (req, res, next) => {
  try {
    const input = validate(z.object({
      currentPassword: z.string().min(6, "请输入当前密码").max(72),
      newPassword: z.string().min(8, "新密码至少 8 位").max(72)
        .regex(/[A-Za-z]/, "新密码至少包含一个字母")
        .regex(/[0-9]/, "新密码至少包含一个数字"),
      confirmation: z.string(),
    }), req.body);
    if (input.newPassword !== input.confirmation) return res.status(400).json({ error: "两次输入的新密码不一致" });
    if (!(await bcrypt.compare(input.currentPassword, req.user.password_hash))) {
      return res.status(403).json({ error: "当前密码不正确" });
    }
    if (await bcrypt.compare(input.newPassword, req.user.password_hash)) {
      return res.status(400).json({ error: "新密码不能与当前密码相同" });
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?").run(passwordHash, req.user.id);
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.user?.sub === req.user.id) socket.disconnect(true);
    }
    res.json({ ok: true, token: signToken(updatedUser) });
  } catch (error) { next(error); }
});

app.delete("/api/account/space", auth, async (req, res, next) => {
  try {
    const input = validate(z.object({ password: z.string().min(6).max(72), confirmation: z.literal("永久删除") }), req.body);
    if (!(await bcrypt.compare(input.password, req.user.password_hash))) {
      return res.status(403).json({ error: "密码不正确，未执行删除" });
    }
    const spaceId = req.user.space_id;
    const mediaFiles = db.prepare("SELECT image_url, video_url FROM moments WHERE space_id = ?").all(spaceId);
    db.transaction(() => {
      db.prepare("DELETE FROM space_settings WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM messages WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM todos WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM anniversaries WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM moments WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM users WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
    })();
    mediaFiles.forEach((item) => {
      removeUploadedMedia(item.image_url);
      removeUploadedMedia(item.video_url);
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const user = db.prepare("SELECT id, space_id, token_version FROM users WHERE id = ?").get(payload.sub);
    if (!user || user.space_id !== payload.spaceId || Number(payload.version || 0) !== user.token_version) throw new Error("missing or outdated user");
    socket.user = { sub: user.id, spaceId: user.space_id };
    next();
  } catch { next(new Error("unauthorized")); }
});
io.on("connection", (socket) => socket.join(`space:${socket.user.spaceId}`));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: "照片不能超过 8MB" });
  res.status(error.status || 500).json({ error: error.message || "服务暂时不可用" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Lumi API listening on http://localhost:${PORT}`);
});

import { io } from "socket.io-client";

export const API_SETTINGS_ENABLED = import.meta.env.VITE_ALLOW_API_SETTINGS === "true";
const DEFAULT_API_ORIGIN = (import.meta.env.VITE_API_URL || (API_SETTINGS_ENABLED ? "" : "http://localhost:8787")).replace(/\/$/, "");
const API_ORIGIN_KEY = "lumi_api_origin";
const TOKEN_KEY = "lumi_token";

function normalizeOrigin(value) {
  const normalized = String(value || "").trim().replace(/\/$/, "");
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("服务器地址格式不正确，请填写完整的 http:// 或 https:// 地址");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("服务器地址只支持 http:// 或 https://");
  if (API_SETTINGS_ENABLED && parsed.protocol !== 'https:') throw new Error("Android App 只允许连接 HTTPS 服务器");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("服务器地址不要包含路径、参数或 # 号");
  return normalized;
}

export const apiOriginStore = {
  get: () => normalizeOrigin(localStorage.getItem(API_ORIGIN_KEY) || DEFAULT_API_ORIGIN),
  set: (value) => {
    const normalized = normalizeOrigin(value);
    if (!normalized) throw new Error("请填写服务器地址");
    localStorage.setItem(API_ORIGIN_KEY, normalized);
    return normalized;
  },
};

export const authStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api(path, options = {}) {
  const apiOrigin = apiOriginStore.get();
  if (!apiOrigin) throw new Error("请先打开“服务器设置”并填写后端地址");
  const headers = new Headers(options.headers || {});
  const token = authStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(`${apiOrigin}${path}`, { ...options, headers });
  } catch {
    throw new Error("无法连接服务器，请检查服务器地址、网络和后端运行状态");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试");
  return payload;
}

export function connectRealtime(onUpdate, onMessage) {
  const token = authStore.get();
  if (!token) return null;
  const apiOrigin = apiOriginStore.get();
  if (!apiOrigin) return null;
  const socket = io(apiOrigin, { auth: { token }, transports: ["websocket", "polling"] });
  socket.on("space:updated", onUpdate);
  socket.on("message:new", onMessage);
  return socket;
}

export function imageUrl(value, fallback = "") {
  if (!value) return fallback;
  if (value.startsWith("/images/")) return value;
  if (value.startsWith("/api/media/")) return `${apiOriginStore.get()}${value}`;
  return value;
}

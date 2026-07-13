import { io } from "socket.io-client";

export const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:8787").replace(/\/$/, "");
const TOKEN_KEY = "lumi_token";

export const authStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = authStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_ORIGIN}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试");
  return payload;
}

export function connectRealtime(onUpdate, onMessage) {
  const token = authStore.get();
  if (!token) return null;
  const socket = io(API_ORIGIN, { auth: { token }, transports: ["websocket", "polling"] });
  socket.on("space:updated", onUpdate);
  socket.on("message:new", onMessage);
  return socket;
}

export function imageUrl(value, fallback = "") {
  if (!value) return fallback;
  if (value.startsWith("/images/")) return value;
  if (value.startsWith("/api/media/")) return `${API_ORIGIN}${value}`;
  return value;
}

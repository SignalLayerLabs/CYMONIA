const SESSION_COOKIE = "cymonia_session";
const OAUTH_COOKIE = "cymonia_oauth_state";

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createOpaqueToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashSecretToken(token, secret = "") {
  return sha256Hex(`${String(secret)}\u0000${String(token)}`);
}

export function parseCookies(header = "") {
  const result = {};
  for (const part of String(header).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1);
    try {
      result[key] = decodeURIComponent(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionCookie(token, maxAgeSeconds = 60 * 60 * 24 * 7) {
  return cookie(SESSION_COOKIE, token, maxAgeSeconds);
}

export function oauthStateCookie(token, maxAgeSeconds = 600) {
  return cookie(OAUTH_COOKIE, token, maxAgeSeconds);
}

export function clearSessionCookie() {
  return cookie(SESSION_COOKIE, "", 0);
}

export function clearOauthStateCookie() {
  return cookie(OAUTH_COOKIE, "", 0);
}

export const AUTH_COOKIE_NAMES = Object.freeze({
  session: SESSION_COOKIE,
  oauthState: OAUTH_COOKIE,
});

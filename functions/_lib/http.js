import { AUTH_COOKIE_NAMES, hashSecretToken, parseCookies } from "./auth.js";
import { getSessionActor } from "./identity.js";

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
  return new Response(JSON.stringify(data), { status, headers });
}

export function redirect(location, status = 302, headers = {}) {
  const out = new Headers(headers);
  out.set("location", location);
  out.set("cache-control", "no-store");
  return new Response(null, { status, headers: out });
}

export async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    const error = new TypeError("content_type_must_be_application_json");
    error.status = 415;
    throw error;
  }
  try {
    return await request.json();
  } catch {
    const error = new TypeError("invalid_json");
    error.status = 400;
    throw error;
  }
}

export async function sessionActor(request, env) {
  const secret = String(env.SESSION_HASH_SECRET || "");
  if (!secret) throw new Error("SESSION_HASH_SECRET_not_configured");
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const raw = cookies[AUTH_COOKIE_NAMES.session];
  if (!raw) return null;
  const tokenHash = await hashSecretToken(raw, secret);
  return getSessionActor(env.CYMONIA_DB, tokenHash);
}

export async function requireActor(request, env) {
  const actor = await sessionActor(request, env);
  if (!actor) {
    const error = new Error("authentication_required");
    error.status = 401;
    throw error;
  }
  return actor;
}

export function safeReturnTo(value) {
  const candidate = String(value || "/#world");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/#world";
  return candidate.slice(0, 500);
}

export function errorResponse(error) {
  const status = Number(error?.status) || ({
    authentication_required: 401,
  }[error?.message] || (error instanceof TypeError || error instanceof RangeError ? 400 : 500));
  const message = status >= 500 ? "internal_error" : String(error?.message || "request_failed");
  if (status >= 500) console.error("CYMONIA API:", error);
  return json({ ok: false, error: message }, status);
}

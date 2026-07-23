import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_SESSION_COOKIE = "kufmon_admin_session";
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_LOGIN_LOCK_MS = 5 * 60 * 1000;
export const ADMIN_LOGIN_MAX_ATTEMPTS = 3;

type AdminLoginState = {
  failedAttempts: number;
  lockedUntil: number;
};

const adminLoginState: AdminLoginState = {
  failedAttempts: 0,
  lockedUntil: 0,
};

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD ?? "").trim();
}

function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

function signSessionPayload(payload: string) {
  const password = getAdminPassword();
  if (!password) return null;

  return createHmac("sha256", password).update(payload).digest("hex");
}

export function createAdminSessionToken(now = Date.now()) {
  const issuedAt = Math.floor(now);
  const payload = String(issuedAt);
  const signature = signSessionPayload(payload);

  if (!signature) return null;

  return `${payload}.${signature}`;
}

export function verifyAdminSessionToken(token: string | null | undefined, now = Date.now()) {
  const password = getAdminPassword();
  if (!password || !token) return false;

  const [issuedAtText, signature] = token.split(".");
  if (!issuedAtText || !signature) return false;

  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt)) return false;
  if (now - issuedAt > ADMIN_SESSION_TTL_MS) return false;
  if (issuedAt > now + 60_000) return false;

  const expected = signSessionPayload(String(issuedAt));
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function isAdminAuthenticated(cookieHeader: string | undefined, now = Date.now()) {
  const token = getCookieValue(cookieHeader, ADMIN_SESSION_COOKIE);
  return verifyAdminSessionToken(token, now);
}

export function buildAdminSessionCookie(now = Date.now()) {
  const token = createAdminSessionToken(now);
  if (!token) return null;

  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildClearedAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function getAdminLoginLockState(now = Date.now()) {
  const remainingMs = Math.max(0, adminLoginState.lockedUntil - now);
  return {
    locked: remainingMs > 0,
    lockedUntil: adminLoginState.lockedUntil,
    remainingMs,
    failedAttempts: adminLoginState.failedAttempts,
  };
}

export function recordAdminLoginFailure(now = Date.now()) {
  const currentLock = getAdminLoginLockState(now);
  if (currentLock.locked) {
    return {
      locked: true,
      lockedUntil: currentLock.lockedUntil,
      shouldNotify: false,
      failedAttempts: currentLock.failedAttempts,
    };
  }

  adminLoginState.failedAttempts += 1;

  if (adminLoginState.failedAttempts >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    adminLoginState.failedAttempts = 0;
    adminLoginState.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;

    return {
      locked: true,
      lockedUntil: adminLoginState.lockedUntil,
      shouldNotify: true,
      failedAttempts: ADMIN_LOGIN_MAX_ATTEMPTS,
    };
  }

  return {
    locked: false,
    lockedUntil: 0,
    shouldNotify: false,
    failedAttempts: adminLoginState.failedAttempts,
  };
}

export function clearAdminLoginState() {
  adminLoginState.failedAttempts = 0;
  adminLoginState.lockedUntil = 0;
}

export function getAdminPasswordConfigured() {
  return Boolean(getAdminPassword());
}


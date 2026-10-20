import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { HttpError } from "./http";
import type { User } from "./types";

const derive = promisify(scrypt);
const initialized = new WeakSet<object>();
export const SESSION_COOKIE = "cosmic_session";
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");

export function authDb() {
  const sql = db();
  if (!initialized.has(sql)) {
    const columns = sql
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((x) => x.name);
    if (!columns.includes("emailVerified"))
      sql.exec(
        "ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.includes("emailNotifications"))
      sql.exec(
        "ALTER TABLE users ADD COLUMN emailNotifications INTEGER NOT NULL DEFAULT 0",
      );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS oauth_accounts (provider TEXT NOT NULL,providerId TEXT NOT NULL,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(provider,providerId),UNIQUE(userId,provider));
      CREATE TABLE IF NOT EXISTS auth_tokens (tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,expiresAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (stateHash TEXT PRIMARY KEY,nonce TEXT NOT NULL,userId TEXT REFERENCES users(id) ON DELETE CASCADE,verifier TEXT NOT NULL,provider TEXT NOT NULL,expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,resetAt INTEGER NOT NULL);
    `);
    initialized.add(sql);
  }
  return sql;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function checkPassword(
  password: string,
  encoded: string | null,
): Promise<boolean> {
  const [salt, expected] = (
    encoded || "0123456789abcdef0123456789abcdef:" + "00".repeat(64)
  ).split(":");
  if (!salt || !expected) return false;
  const hash = (await derive(password, salt, 64)) as Buffer;
  const target = Buffer.from(expected, "hex");
  return (
    target.length === hash.length &&
    timingSafeEqual(target, hash) &&
    encoded !== null
  );
}

export function findUser(id: string): User | null {
  const row = authDb()
    .prepare(
      "SELECT id,name,email,role,premiumUntil,verified,emailVerified,emailNotifications,(passwordHash IS NOT NULL) AS hasPassword FROM users WHERE id=?",
    )
    .get(id);
  if (!row) return null;
  return {
    ...row,
    verified: !!row.verified,
    emailVerified: !!row.emailVerified,
    emailNotifications: !!row.emailNotifications,
    hasPassword: !!row.hasPassword,
    linkedProviders: authDb()
      .prepare("SELECT provider FROM oauth_accounts WHERE userId=?")
      .all(id)
      .map((r) => String(r.provider)),
  } as unknown as User;
}

export function currentUser(request: NextRequest): User | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = authDb()
    .prepare("SELECT userId FROM sessions WHERE tokenHash=? AND expiresAt>?")
    .get(digest(token), new Date().toISOString());
  return row ? findUser(String(row.userId)) : null;
}

export function requireUser(request: NextRequest): User {
  const user = currentUser(request);
  if (!user) throw new HttpError(401, "Bạn hãy đăng nhập để tiếp tục.");
  return user;
}

export function requireRecentLogin(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value || "";
  const row = authDb()
    .prepare("SELECT createdAt FROM sessions WHERE tokenHash=?")
    .get(digest(token));
  if (!row || Date.now() - Date.parse(String(row.createdAt)) > 15 * 60000)
    throw new HttpError(
      401,
      "Để xóa hoàn toàn, hãy đăng xuất rồi đăng nhập lại bằng tài khoản liên kết trong vòng 15 phút.",
    );
}

export function setSession(response: NextResponse, userId: string) {
  const token = secret();
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 86400000);
  authDb()
    .prepare("DELETE FROM sessions WHERE expiresAt<=?")
    .run(now.toISOString());
  authDb()
    .prepare(
      "INSERT INTO sessions(tokenHash,userId,expiresAt,createdAt) VALUES(?,?,?,?)",
    )
    .run(digest(token), userId, expires.toISOString(), now.toISOString());
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function clearSession(response: NextResponse, request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token)
    authDb()
      .prepare("DELETE FROM sessions WHERE tokenHash=?")
      .run(digest(token));
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function throttle(key: string, limit: number, windowMs: number): void {
  const sql = authDb();
  const now = Date.now();
  sql.prepare("DELETE FROM rate_limits WHERE resetAt<=?").run(now);
  const row = sql
    .prepare(
      `INSERT INTO rate_limits(key,count,resetAt) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,
    )
    .get(digest(key), now + windowMs);
  if (Number(row?.count) > limit)
    throw new HttpError(429, "Bạn thao tác hơi nhanh. Vui lòng thử lại sau.");
}

export function requestAddress(request: NextRequest): string {
  // Only enable when a trusted proxy overwrites this header, never on a public direct listener.
  return process.env.TRUST_PROXY === "true"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    : "direct";
}

export function newUser(
  name: string,
  email: string,
  passwordHash: string | null,
  emailVerified = false,
): string {
  const id = randomUUID();
  authDb()
    .prepare(
      "INSERT INTO users(id,name,email,passwordHash,emailVerified,createdAt) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      name,
      email,
      passwordHash,
      emailVerified ? 1 : 0,
      new Date().toISOString(),
    );
  return id;
}

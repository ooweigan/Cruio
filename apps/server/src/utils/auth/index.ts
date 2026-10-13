import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { Database } from "@/db/database";

export type AuthTokenPurpose = "emailVerification" | "passwordReset";
export type AuthSecurityEventType = "emailVerification" | "passwordReset" | "sessionRevokeOne" | "sessionRevokeOthers" | "userDisabled" | "userEnabled";
export type AuthSecurityEventOutcome = "success" | "invalid" | "notEligible" | "denied";

const rateWindows = new Map<string, { count: number; resetAt: number }>();
const rateLimitSalt = randomBytes(32);

export function createAuthToken() {
  return randomBytes(32).toString("base64url");
}

export async function saveAuthToken(database: Database, userId: string, purpose: AuthTokenPurpose, expiresAt: Date) {
  const token = createAuthToken();
  const saved = await database.begin(async transaction => {
    const users = await transaction<{ emailVerifiedAt: Date | null }[]>`
      SELECT email_verified_at AS "emailVerifiedAt" FROM users WHERE id = ${userId} FOR UPDATE
    `;
    if (!users[0] || (purpose === "emailVerification" ? users[0].emailVerifiedAt !== null : users[0].emailVerifiedAt === null)) return false;
    await transaction`UPDATE auth_tokens SET consumed_at = COALESCE(consumed_at, now())
      WHERE user_id = ${userId} AND purpose = ${purpose} AND consumed_at IS NULL`;
    await transaction`INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${purpose}, ${await hashAuthToken(token)}, ${expiresAt})`;
    return true;
  });
  return saved ? token : null;
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function recordAuthSecurityEvent(input: {
  database: Database;
  actorUserId: string | null;
  subjectUserId: string | null;
  eventType: AuthSecurityEventType;
  outcome: AuthSecurityEventOutcome;
  details?: Record<string, string | number | boolean | null>;
}) {
  await input.database`
    INSERT INTO auth_security_events (id, actor_user_id, subject_user_id, event_type, outcome, details)
    VALUES (${randomUUID()}, ${input.actorUserId}, ${input.subjectUserId}, ${input.eventType}, ${input.outcome}, ${JSON.stringify(input.details ?? {})}::text::jsonb)
  `;
}

export async function completeAuthToken(input: {
  database: Database;
  tokenHash: string;
  purpose: AuthTokenPurpose;
  passwordHash: string;
}) {
  const { database, tokenHash, purpose, passwordHash } = input;
  const eventType: AuthSecurityEventType = purpose;
  const candidates = await database<{ userId: string }[]>`
    SELECT user_id AS "userId" FROM auth_tokens WHERE token_hash = ${tokenHash} AND purpose = ${purpose}
  `;
  const userId = candidates[0]?.userId;
  if (!userId) {
    await recordAuthSecurityEvent({ database, actorUserId: null, subjectUserId: null, eventType, outcome: "invalid", details: { purpose } });
    return { success: false, userId: null, outcome: "invalid" as const };
  }
  return database.begin(async transaction => {
    const users = await transaction<{ emailVerifiedAt: Date | null }[]>`
      SELECT email_verified_at AS "emailVerifiedAt" FROM users WHERE id = ${userId} FOR UPDATE
    `;
    const emailVerified = users[0]?.emailVerifiedAt != null;
    const tokens = await transaction<{ id: string; consumedAt: Date | null }[]>`
      SELECT id, consumed_at AS "consumedAt"
      FROM auth_tokens WHERE token_hash = ${tokenHash} AND user_id = ${userId} AND purpose = ${purpose}
      FOR UPDATE
    `;
    const authToken = tokens[0];
    const tokenState = authToken ? await transaction<{ consumedAt: Date | null; unexpired: boolean }[]>`
      SELECT consumed_at AS "consumedAt", expires_at > clock_timestamp() AS unexpired
      FROM auth_tokens WHERE id = ${authToken.id}
    ` : [];
    if (!users[0] || !authToken || tokenState[0]?.consumedAt || !tokenState[0]?.unexpired) {
      await recordAuthSecurityEvent({ database: transaction as Database, actorUserId: null, subjectUserId: userId, eventType, outcome: "invalid", details: { purpose } });
      return { success: false, userId, outcome: "invalid" as const };
    }
    if (purpose === "emailVerification" ? emailVerified : !emailVerified) {
      await recordAuthSecurityEvent({ database: transaction as Database, actorUserId: null, subjectUserId: userId, eventType, outcome: "notEligible", details: { purpose } });
      return { success: false, userId, outcome: "notEligible" as const };
    }
    const consumed = await transaction<{ id: string }[]>`
      UPDATE auth_tokens SET consumed_at = clock_timestamp()
      WHERE id = ${authToken.id} AND consumed_at IS NULL AND expires_at > clock_timestamp()
      RETURNING id
    `;
    if (!consumed[0]) {
      await recordAuthSecurityEvent({ database: transaction as Database, actorUserId: null, subjectUserId: userId, eventType, outcome: "invalid", details: { purpose } });
      return { success: false, userId, outcome: "invalid" as const };
    }
    if (purpose === "emailVerification") {
      await transaction`UPDATE users SET password_hash = ${passwordHash}, email_verified_at = clock_timestamp() WHERE id = ${userId} AND email_verified_at IS NULL`;
    } else {
      await transaction`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId} AND email_verified_at IS NOT NULL`;
    }
    await transaction`DELETE FROM sessions WHERE user_id = ${userId}`;
    await transaction`UPDATE auth_tokens SET consumed_at = COALESCE(consumed_at, clock_timestamp()) WHERE user_id = ${userId} AND consumed_at IS NULL`;
    await recordAuthSecurityEvent({ database: transaction as Database, actorUserId: userId, subjectUserId: userId, eventType, outcome: "success", details: { purpose } });
    return { success: true, userId, outcome: "success" as const };
  });
}

export function takeAuthRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  for (const [rateKey, state] of rateWindows) if (state.resetAt <= now) rateWindows.delete(rateKey);
  if (rateWindows.size > 10000) rateWindows.delete(rateWindows.keys().next().value ?? "");
  const rateKey = createHash("sha256").update(rateLimitSalt).update(key).digest("hex");
  const current = rateWindows.get(rateKey);
  if (!current || current.resetAt <= now) {
    rateWindows.set(rateKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function mailConfiguration() {
  const host = process.env.CRUIO_SMTP_HOST?.trim();
  const port = Number(process.env.CRUIO_SMTP_PORT);
  const user = process.env.CRUIO_SMTP_USER;
  const password = process.env.CRUIO_SMTP_PASSWORD;
  const from = process.env.CRUIO_SMTP_FROM?.trim();
  const publicUrl = process.env.CRUIO_PUBLIC_URL?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !from || !publicUrl) return null;
  let parsedUrl: URL;
  try { parsedUrl = new URL(publicUrl); } catch { return null; }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) return null;
  return { host, port, user, password, from, publicUrl: parsedUrl.origin };
}

function localOutboxEnabled() {
  return process.env.NODE_ENV === "dev"
    && process.env.CRUIO_AUTH_EMAIL_OUTBOX === "true"
    && process.env.CRUIO_ENABLE_LOCAL_EMAIL_OUTBOX === "true";
}

export function authEmailReady(dataDirectory: string) {
  return localOutboxEnabled() || Boolean(mailConfiguration());
}

export async function sendAuthEmail(input: { dataDirectory: string; to: string; subject: string; text: string }) {
  if (localOutboxEnabled()) {
    const directory = join(input.dataDirectory, "privateAuthMail");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const files = await readdir(directory);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(directory, file);
      const details = await stat(filePath).catch(() => null);
      if (details && details.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
    }
    const filePath = join(directory, `${randomUUID()}.json`);
    await writeFile(filePath, JSON.stringify({ to: input.to, subject: input.subject, text: input.text }), { flag: "wx", mode: 0o600 });
    return "outbox" as const;
  }
  const config = mailConfiguration();
  if (!config) throw new Error("Authentication email transport is not configured.");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  await transporter.sendMail({ from: config.from, to: input.to, subject: input.subject, text: input.text });
  return "smtp" as const;
}

export function authEmailLink(route: "verifyEmail" | "passwordReset" | "login", token?: string) {
  const base = localOutboxEnabled() ? process.env.CRUIO_PUBLIC_URL?.trim() || "http://localhost:5173" : mailConfiguration()?.publicUrl;
  if (!base) throw new Error("Authentication email public URL is not configured.");
  const url = new URL(base);
  url.hash = route === "login" ? "/login" : `/${route}?token=${encodeURIComponent(token ?? "")}`;
  return url.toString();
}

export async function createSession(database: Database, userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await database`INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent)
    VALUES (${id}, ${userId}, ${hashAuthToken(token)}, ${expiresAt}, ${userAgent?.slice(0, 500) ?? null})`;
  return { token, id, expiresAt };
}

export function setSessionCookie(response: import("express").Response, token: string) {
  response.cookie("cruio_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(response: import("express").Response) {
  response.clearCookie("cruio_session", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function readSessionToken(request: import("express").Request) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name !== "cruio_session") continue;
    try { return decodeURIComponent(parts.join("=")); } catch { return null; }
  }
  return null;
}

export async function currentSession(database: Database, request: import("express").Request) {
  const token = readSessionToken(request);
  if (!token) return null;
  const rows = await database<{ id: string; userId: string; email: string; emailVerifiedAt: Date; userAgent: string | null; createdAt: Date; expiresAt: Date }[]>`
    SELECT sessions.id, sessions.user_id AS "userId", users.email, users.email_verified_at AS "emailVerifiedAt", sessions.user_agent AS "userAgent",
      sessions.created_at AS "createdAt", sessions.expires_at AS "expiresAt"
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${hashAuthToken(token)} AND sessions.expires_at > now() AND users.email_verified_at IS NOT NULL AND users.disabled_at IS NULL
  `;
  return rows[0] ?? null;
}

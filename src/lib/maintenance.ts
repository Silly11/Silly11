import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { db, transaction } from "./db";

const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAPSHOT = /^(\d+)-[0-9a-f-]{36}\.json$/;
const HOUR = 3_600_000;

function positiveSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function backupRetentionDays(): number {
  return positiveSetting("BACKUP_RETENTION_DAYS", 30);
}

function validateUserId(userId: string): void {
  if (!USER_ID.test(userId)) throw new Error("Invalid backup user identifier");
}

// Validate every directory component, including a configured DATA_DIR, before writing.
function safeDirectory(directory: string): void {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute
    .slice(root.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Backup path must contain only real directories");
    }
  }
}

function paths(userId: string) {
  validateUserId(userId);
  const data = resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR || "data",
  );
  return {
    data,
    snapshots: join(data, "backups", userId),
    keys: join(data, "backup-keys"),
    key: join(data, "backup-keys", `${userId}.key`),
  };
}

function readKey(path: string): Buffer {
  const handle = openSync(
    /* turbopackIgnore: true */ path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    if (!fstatSync(handle).isFile()) throw new Error("Invalid backup key file");
    const key = readFileSync(handle);
    if (key.length !== 32) throw new Error("Invalid backup key length");
    return key;
  } finally {
    closeSync(handle);
  }
}

/** Call synchronously inside the same SQLite write transaction as content deletion. */
export function purgeUserBackups(userId: string): void {
  const location = paths(userId);
  safeDirectory(location.data);
  // Destroy the separately stored key first, so residual snapshots are unreadable.
  if (existsSync(/* turbopackIgnore: true */ dirname(location.key))) {
    safeDirectory(dirname(location.key));
    try {
      unlinkSync(location.key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (existsSync(/* turbopackIgnore: true */ dirname(location.snapshots))) {
    safeDirectory(dirname(location.snapshots));
    // rmSync does not follow symlinks; never traverse a linked user directory.
    if (existsSync(/* turbopackIgnore: true */ location.snapshots)) {
      const stat = lstatSync(location.snapshots);
      if (stat.isSymbolicLink()) unlinkSync(location.snapshots);
      else rmSync(location.snapshots, { recursive: true, force: true });
    }
  }
}

function initMaintenance(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS letter_email_outbox (
      letterId TEXT PRIMARY KEY REFERENCES letters(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt TEXT NOT NULL, firstAttemptAt TEXT, createdAt TEXT NOT NULL, sentAt TEXT
    );
  `);
}

/** Deliver in-app notices even when email is disabled. Safe to call on page refresh. */
export function deliverDueLetters(now = new Date()): number {
  const timestamp = now.toISOString();
  initMaintenance();
  return transaction(() => {
    const due = db()
      .prepare(
        "SELECT id, userId FROM letters WHERE status = 'scheduled' AND deliverAt <= ?",
      )
      .all(timestamp) as { id: string; userId: string }[];
    for (const letter of due) {
      db()
        .prepare("UPDATE letters SET status = 'delivered' WHERE id = ?")
        .run(letter.id);
      db()
        .prepare(
          "INSERT OR IGNORE INTO notifications (id,userId,text,createdAt) VALUES (?,?,?,?)",
        )
        .run(
          `letter:${letter.id}`,
          letter.userId,
          "Một lá thư từ quá khứ đang chờ bạn mở trong Thư tương lai.",
          timestamp,
        );
      // Credentials, verified address, and current opt-in are checked again at send time.
      db()
        .prepare(
          "INSERT OR IGNORE INTO letter_email_outbox (letterId,userId,nextAttemptAt,createdAt) SELECT ?,id,?,? FROM users WHERE id=? AND emailVerified=1 AND emailNotifications=1",
        )
        .run(letter.id, timestamp, timestamp, letter.userId);
    }
    return due.length;
  });
}

function snapshotUsers(now: Date): number {
  const interval = positiveSetting("BACKUP_INTERVAL_MS", HOUR);
  const retention = backupRetentionDays() * 24 * HOUR;
  return transaction(() => {
    const previous = db()
      .prepare("SELECT value FROM maintenance_state WHERE key = 'backupAt'")
      .get() as { value: string } | undefined;
    if (previous && now.getTime() - Number(previous.value) < interval) return 0;
    const users = db()
      .prepare("SELECT id,name,email,role,premiumUntil,createdAt FROM users")
      .all() as { id: string }[];
    for (const user of users) {
      const location = paths(user.id);
      safeDirectory(location.snapshots);
      safeDirectory(location.keys);
      if (!existsSync(/* turbopackIgnore: true */ location.key)) {
        const handle = openSync(
          /* turbopackIgnore: true */
          location.key,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFileSync(handle, randomBytes(32));
        } finally {
          closeSync(handle);
        }
      }
      const key = readKey(location.key);
      const snapshot = {
        version: 1,
        capturedAt: now.toISOString(),
        user,
        entries: db()
          .prepare(
            "SELECT id,displayName,mood,content,visibility,supportVisible,createdAt FROM entries WHERE userId = ?",
          )
          .all(user.id),
        letters: db()
          .prepare(
            "SELECT id,content,deliverAt,status,createdAt FROM letters WHERE userId = ?",
          )
          .all(user.id),
        messages: db()
          .prepare(
            "SELECT id,kind,content,createdAt FROM messages WHERE userId = ?",
          )
          .all(user.id),
        peerMessages: db()
          .prepare(
            "SELECT id,content,createdAt FROM peer_messages WHERE senderId = ?",
          )
          .all(user.id),
      };
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(user.id));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(snapshot), "utf8"),
        cipher.final(),
      ]);
      key.fill(0);
      const envelope = JSON.stringify({
        version: 1,
        algorithm: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      });
      const path = join(
        location.snapshots,
        `${now.getTime()}-${randomUUID()}.json`,
      );
      const temporary = `${path}.tmp`;
      const handle = openSync(
        /* turbopackIgnore: true */
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(handle, envelope);
      } finally {
        closeSync(handle);
      }
      renameSync(temporary, path);
      for (const file of readdirSync(
        /* turbopackIgnore: true */ location.snapshots,
      )) {
        const match = SNAPSHOT.exec(file);
        if (match && Number(match[1]) <= now.getTime() - retention) {
          unlinkSync(join(location.snapshots, file));
        }
      }
    }
    // Delete orphaned snapshots/keys, e.g. following an interrupted deletion.
    const active = new Set(users.map((user) => user.id));
    const root = resolve(
      /* turbopackIgnore: true */ process.env.DATA_DIR || "data",
    );
    for (const directory of [
      join(root, "backups"),
      join(root, "backup-keys"),
    ]) {
      if (!existsSync(/* turbopackIgnore: true */ directory)) continue;
      safeDirectory(directory);
      for (const filename of readdirSync(
        /* turbopackIgnore: true */ directory,
      )) {
        const id = filename.replace(/\.key$/, "");
        if (USER_ID.test(id) && !active.has(id)) purgeUserBackups(id);
      }
    }
    db()
      .prepare(
        "INSERT INTO maintenance_state (key,value) VALUES ('backupAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(now.getTime()));
    return users.length;
  });
}

async function sendLetterEmails(now: Date): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl) return 0;
  const url = new URL(appUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid APP_URL");
  const columns = db().prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  if (
    !["emailVerified", "emailNotifications"].every((name) =>
      columns.some((column) => column.name === name),
    )
  )
    return 0;
  const queued = db()
    .prepare(
      "SELECT letterId FROM letter_email_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY createdAt LIMIT 50",
    )
    .all(now.toISOString()) as { letterId: string }[];
  let sent = 0;
  for (const queuedLetter of queued) {
    // Recheck ownership, deletion, verification and opt-in immediately before dispatch.
    const item = db()
      .prepare(
        `SELECT o.letterId,o.attempts,o.firstAttemptAt,u.email FROM letter_email_outbox o
      JOIN letters l ON l.id=o.letterId AND l.userId=o.userId
      JOIN users u ON u.id=o.userId
      WHERE o.letterId=? AND o.status='pending' AND l.status='delivered'
      AND u.emailVerified=1 AND u.emailNotifications=1`,
      )
      .get(queuedLetter.letterId) as
      | {
          letterId: string;
          attempts: number;
          firstAttemptAt: string | null;
          email: string;
        }
      | undefined;
    if (!item) {
      db()
        .prepare(
          "UPDATE letter_email_outbox SET status='cancelled' WHERE letterId=? AND status='pending'",
        )
        .run(queuedLetter.letterId);
      continue;
    }
    // Resend idempotency keys expire after 24 hours; never retry beyond that window.
    if (
      item.attempts >= 8 ||
      (item.firstAttemptAt &&
        now.getTime() - Date.parse(item.firstAttemptAt) >= 23 * HOUR)
    ) {
      db()
        .prepare(
          "UPDATE letter_email_outbox SET status='failed' WHERE letterId=?",
        )
        .run(item.letterId);
      continue;
    }
    db()
      .prepare(
        "UPDATE letter_email_outbox SET attempts=attempts+1,firstAttemptAt=COALESCE(firstAttemptAt,?) WHERE letterId=?",
      )
      .run(now.toISOString(), item.letterId);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `cosmic-letter-${item.letterId}`,
        },
        body: JSON.stringify({
          from,
          to: [item.email],
          subject: "COSMIC ECHO — Thư tương lai của bạn đã đến",
          text: `Một lá thư từ quá khứ đang chờ bạn. Đăng nhập COSMIC ECHO để mở thư: ${url.origin}\nNội dung thư chỉ được hiển thị trong tài khoản của bạn.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Email delivery failed");
      await response.body?.cancel();
      db()
        .prepare(
          "UPDATE letter_email_outbox SET status='sent',sentAt=? WHERE letterId=?",
        )
        .run(now.toISOString(), item.letterId);
      sent++;
    } catch {
      const next = new Date(
        now.getTime() + 60_000 * 2 ** item.attempts,
      ).toISOString();
      db()
        .prepare(
          "UPDATE letter_email_outbox SET nextAttemptAt=? WHERE letterId=?",
        )
        .run(next, item.letterId);
    }
  }
  return sent;
}

let running = false;
/** Run one worker process per DATA_DIR. Web handlers only use deliverDueLetters(). */
export async function runMaintenance(options: { now?: Date } = {}) {
  if (running) throw new Error("Maintenance is already running");
  running = true;
  try {
    const now = options.now ?? new Date();
    const delivered = deliverDueLetters(now);
    const backedUp = snapshotUsers(now);
    const emailed = await sendLetterEmails(now);
    return { delivered, backedUp, emailed };
  } finally {
    running = false;
  }
}

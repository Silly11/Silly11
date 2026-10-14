import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

let connection: DatabaseSync | undefined;
export function db(): DatabaseSync {
  if (connection) return connection;
  const dir = resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR || "data",
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(resolve(dir, "cosmic.sqlite"));
  connection.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT, emailVerified INTEGER NOT NULL DEFAULT 0, emailNotifications INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','expert','admin')),
      premiumUntil TEXT, verified INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      displayName TEXT NOT NULL, mood TEXT NOT NULL CHECK(mood IN ('joy','sadness','unsaid')),
      content TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('private','public','group')),
      groupId TEXT REFERENCES groups(id) ON DELETE CASCADE, supportVisible INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS letters (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL, deliverAt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_state (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, used INTEGER NOT NULL DEFAULT 0,
      cooldownUntil TEXT, reservationId TEXT, reservedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'waiting', assignedTo TEXT REFERENCES users(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL, closedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket ON tickets(userId) WHERE status != 'closed';
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('user','ai','support')), content TEXT NOT NULL,
      ticketId TEXT REFERENCES tickets(id) ON DELETE CASCADE, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      passwordHash TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      groupId TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(groupId,userId)
    );
    CREATE TABLE IF NOT EXISTS connection_requests (
      id TEXT PRIMARY KEY, fromId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      toId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fromName TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL,
      UNIQUE(fromId,toId)
    );
    CREATE TABLE IF NOT EXISTS peer_messages (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES connection_requests(id) ON DELETE CASCADE,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS peer_request ON peer_messages(requestId);
    CREATE INDEX IF NOT EXISTS entry_user ON entries(userId);
    CREATE INDEX IF NOT EXISTS message_user ON messages(userId,createdAt);
    CREATE INDEX IF NOT EXISTS letter_due ON letters(status,deliverAt);
  `);
  return connection;
}

export function transaction<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
}

export function closeDb(): void {
  connection?.close();
  connection = undefined;
}

// Run only after the deletion transaction commits; active readers may defer truncation.
export function checkpointDeletedData(): void {
  db().prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
}

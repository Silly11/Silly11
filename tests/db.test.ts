import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDb, db } from "../src/lib/db";

let directory: string;
let previousDataDir: string | undefined;
beforeEach(() => {
  closeDb();
  previousDataDir = process.env.DATA_DIR;
  directory = mkdtempSync(join(tmpdir(), "cosmic-db-"));
  process.env.DATA_DIR = directory;
});
afterEach(() => {
  closeDb();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(directory, { recursive: true, force: true });
});

test("legacy journals migrate to Earth without changing content, ownership or sharing metadata", () => {
  const legacy = new DatabaseSync(join(directory, "cosmic.sqlite"));
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      passwordHash TEXT, emailVerified INTEGER NOT NULL DEFAULT 0,
      emailNotifications INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user',
      premiumUntil TEXT, verified INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      passwordHash TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE group_members (
      groupId TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(groupId,userId)
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      displayName TEXT NOT NULL, mood TEXT NOT NULL CHECK(mood IN ('joy','sadness','unsaid')),
      content TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('private','public','group')),
      groupId TEXT REFERENCES groups(id) ON DELETE CASCADE,
      supportVisible INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    INSERT INTO users (id,name,email,createdAt) VALUES
      ('alice','Alice','alice@example.com','2026-01-01T00:00:00.000Z'),
      ('bob','Bob','bob@example.com','2026-01-02T00:00:00.000Z');
    INSERT INTO groups (id,name,ownerId,createdAt) VALUES
      ('circle','Vòng tròn','alice','2026-01-03T00:00:00.000Z');
    INSERT INTO group_members (groupId,userId) VALUES ('circle','alice'),('circle','bob');
    INSERT INTO entries (id,userId,displayName,mood,content,visibility,groupId,supportVisible,createdAt) VALUES
      ('private','alice','Bạn','sadness','Tâm tư riêng vẫn còn','private',NULL,0,'2026-01-04T00:00:00.000Z'),
      ('support','alice','Bạn','unsaid','Chia sẻ có sự đồng ý','private',NULL,1,'2026-01-05T00:00:00.000Z'),
      ('public','bob','Ẩn danh','joy','Một niềm vui công khai','public',NULL,0,'2026-01-06T00:00:00.000Z'),
      ('group','bob','Bạn trong nhóm','unsaid','Chỉ chia sẻ trong nhóm','group','circle',0,'2026-01-07T00:00:00.000Z');
  `);
  const originals = legacy
    .prepare("SELECT * FROM entries ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  const originalGroups = legacy.prepare("SELECT * FROM groups").all();
  const originalMembers = legacy
    .prepare("SELECT * FROM group_members ORDER BY userId")
    .all();
  assert.ok(
    !legacy
      .prepare("PRAGMA table_info(entries)")
      .all()
      .some((column) => column.name === "planetId"),
  );
  legacy.close();

  const expected = originals.map((row) => ({ ...row, planetId: "earth" }));
  for (let opening = 0; opening < 2; opening++) {
    assert.deepEqual(
      db()
        .prepare("SELECT * FROM entries ORDER BY id")
        .all()
        .map((row) => ({ ...row })),
      expected,
    );
    assert.deepEqual(
      db().prepare("SELECT * FROM groups").all(),
      originalGroups,
    );
    assert.deepEqual(
      db().prepare("SELECT * FROM group_members ORDER BY userId").all(),
      originalMembers,
    );
    assert.equal(
      db()
        .prepare("PRAGMA table_info(entries)")
        .all()
        .filter((column) => column.name === "planetId").length,
      1,
    );
    assert.deepEqual(db().prepare("PRAGMA foreign_key_check").all(), []);
    closeDb();
  }
});

test("planet constraints accept the eight destinations, default to Earth and reject invalid writes", () => {
  db().exec(`
    INSERT INTO users (id,name,email,createdAt)
      VALUES ('author','Author','author@example.com','2026-01-01T00:00:00.000Z');
    INSERT INTO entries (id,userId,displayName,mood,content,visibility,createdAt)
      VALUES ('default','author','Bạn','joy','Tâm tư cũ','private','2026-01-02T00:00:00.000Z');
  `);
  assert.equal(
    db().prepare("SELECT planetId FROM entries WHERE id='default'").get()
      ?.planetId,
    "earth",
  );
  const insert = db().prepare(
    "INSERT INTO entries (id,userId,displayName,mood,content,visibility,createdAt,planetId) VALUES (?,'author','Bạn','joy','Tâm tư','private','2026-01-03T00:00:00.000Z',?)",
  );
  const destinations = [
    "mercury",
    "venus",
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
  ];
  for (const planet of destinations) insert.run(planet, planet);
  for (const invalid of ["pluto", "", "Earth", null])
    assert.throws(() => insert.run("invalid", invalid), /constraint failed/i);
  assert.throws(
    () =>
      db()
        .prepare("UPDATE entries SET planetId=? WHERE id='mars'")
        .run("pluto"),
    /constraint failed/i,
  );
  closeDb();
  assert.equal(
    db().prepare("SELECT COUNT(*) AS total FROM entries").get()?.total,
    9,
  );
  for (const planet of destinations)
    assert.equal(
      db().prepare("SELECT planetId FROM entries WHERE id=?").get(planet)
        ?.planetId,
      planet,
    );
});

import assert from "node:assert/strict";
import { createDecipheriv, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { closeDb, db, transaction } from "../src/lib/db";
import {
  deliverDueLetters,
  purgeUserBackups,
  runMaintenance,
} from "../src/lib/maintenance";

const now = new Date("2030-01-01T12:00:00.000Z");
let directory: string;
let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  closeDb();
  originalEnv = { ...process.env };
  directory = mkdtempSync(join(tmpdir(), "cosmic-maintenance-"));
  process.env.DATA_DIR = directory;
  for (const key of [
    "BACKUP_INTERVAL_MS",
    "BACKUP_RETENTION_DAYS",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "APP_URL",
  ])
    delete process.env[key];
});
afterEach(() => {
  closeDb();
  process.env = originalEnv;
  rmSync(directory, { recursive: true, force: true });
});

function addUser(email = "person@example.com", verified = 0, optedIn = 0) {
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO users (id,name,email,passwordHash,emailVerified,emailNotifications,createdAt) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "Người dùng",
      email,
      "secret-password-hash",
      verified,
      optedIn,
      now.toISOString(),
    );
  db()
    .prepare(
      "INSERT INTO sessions (tokenHash,userId,expiresAt,createdAt) VALUES (?,?,?,?)",
    )
    .run(randomUUID(), id, "2031-01-01T00:00:00.000Z", now.toISOString());
  return id;
}
function addLetter(userId: string, delivery = "2030-01-01T11:00:00.000Z") {
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO letters (id,userId,content,deliverAt,createdAt) VALUES (?,?,?,?,?)",
    )
    .run(id, userId, "Tâm tư riêng tư tuyệt đối", delivery, now.toISOString());
  return id;
}
function snapshots(userId: string) {
  return readdirSync(join(directory, "backups", userId));
}
function decryptSnapshot(userId: string) {
  const text = readFileSync(
    join(directory, "backups", userId, snapshots(userId)[0]),
    "utf8",
  );
  const envelope = JSON.parse(text);
  const key = readFileSync(join(directory, "backup-keys", `${userId}.key`));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return {
    text,
    data: JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ),
  };
}

test("hourly encrypted backups contain only their owner's content and no authentication secrets", async () => {
  const first = addUser();
  const other = addUser("other@example.com");
  addLetter(first);
  addLetter(other);
  assert.equal((await runMaintenance({ now })).backedUp, 2);
  const snapshot = decryptSnapshot(first);
  assert.equal(snapshot.data.user.id, first);
  assert.equal(snapshot.data.letters.length, 1);
  assert.equal(snapshot.data.letters[0].content, "Tâm tư riêng tư tuyệt đối");
  assert.ok(!snapshot.text.includes("Tâm tư"));
  assert.ok(!snapshot.text.includes("person@example.com"));
  const decoded = JSON.stringify(snapshot.data);
  assert.ok(!decoded.includes("passwordHash"));
  assert.ok(!decoded.includes("secret-password-hash"));
  assert.ok(!decoded.includes("tokenHash"));
  assert.ok(!decoded.includes("other@example.com"));
  assert.ok(!decoded.includes(other));
  assert.equal(
    (await runMaintenance({ now: new Date(now.getTime() + 30 * 60_000) }))
      .backedUp,
    0,
  );
  assert.equal(snapshots(first).length, 1);
  assert.equal(
    (await runMaintenance({ now: new Date(now.getTime() + 3_600_000) }))
      .backedUp,
    2,
  );
  assert.equal(snapshots(first).length, 2);
});

test("permanent deletion destroys historic snapshots and key, then future snapshots omit deleted content", async () => {
  const userId = addUser();
  const letterId = addLetter(userId);
  await runMaintenance({ now });
  const originalKey = readFileSync(
    join(directory, "backup-keys", `${userId}.key`),
  );
  transaction(() => {
    purgeUserBackups(userId);
    db().prepare("DELETE FROM letters WHERE id=?").run(letterId);
  });
  assert.equal(
    existsSync(join(directory, "backup-keys", `${userId}.key`)),
    false,
  );
  assert.equal(existsSync(join(directory, "backups", userId)), false);
  await runMaintenance({ now: new Date(now.getTime() + 3_600_000) });
  assert.equal(decryptSnapshot(userId).data.letters.length, 0);
  assert.notDeepEqual(
    readFileSync(join(directory, "backup-keys", `${userId}.key`)),
    originalKey,
  );
  transaction(() => {
    purgeUserBackups(userId);
    db().prepare("DELETE FROM users WHERE id=?").run(userId);
  });
  await runMaintenance({ now: new Date(now.getTime() + 7_200_000) });
  assert.equal(existsSync(join(directory, "backups", userId)), false);
  assert.equal(
    db().prepare("SELECT * FROM letter_email_outbox").all().length,
    0,
  );
});

test("configured retention expires snapshots and rejects path traversal/symlink writes", async () => {
  const userId = addUser();
  process.env.BACKUP_RETENTION_DAYS = "1";
  await runMaintenance({ now });
  const old = snapshots(userId)[0];
  await runMaintenance({ now: new Date(now.getTime() + 24 * 3_600_000) });
  assert.equal(snapshots(userId).length, 1);
  assert.ok(!snapshots(userId).includes(old));
  assert.throws(
    () => purgeUserBackups("../../outside"),
    /Invalid backup user identifier/,
  );
  rmSync(join(directory, "backups", userId), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "cosmic-outside-"));
  try {
    symlinkSync(outside, join(directory, "backups", userId));
    await assert.rejects(
      runMaintenance({ now: new Date(now.getTime() + 25 * 3_600_000) }),
      /real directories/,
    );
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("due letters deliver once; future and deleted letters never create a notification", () => {
  const userId = addUser();
  const due = addLetter(userId);
  const future = addLetter(userId, "2030-01-02T12:00:00.000Z");
  const deleted = addLetter(userId);
  db().prepare("DELETE FROM letters WHERE id=?").run(deleted);
  assert.equal(deliverDueLetters(now), 1);
  assert.equal(deliverDueLetters(now), 0);
  const notices = db().prepare("SELECT id,text FROM notifications").all() as {
    id: string;
    text: string;
  }[];
  assert.deepEqual(
    notices.map((notice) => notice.id),
    [`letter:${due}`],
  );
  assert.ok(!notices[0].text.includes("Tâm tư riêng tư"));
  assert.equal(
    (
      db().prepare("SELECT status FROM letters WHERE id=?").get(future) as {
        status: string;
      }
    ).status,
    "scheduled",
  );
});

test("email requires verified opt-in, retries with stable idempotency and omits letter text", async (t) => {
  const userId = addUser("verified@example.com", 1, 1);
  addLetter(userId);
  addLetter(addUser("unverified@example.com", 0, 1));
  addLetter(addUser("optedout@example.com", 1, 0));
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "COSMIC ECHO <letters@example.com>";
  process.env.APP_URL = "https://cosmic.example.com";
  const calls: RequestInit[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options: RequestInit) => {
      calls.push(options);
      return new Response("{}", { status: calls.length === 1 ? 503 : 200 });
    },
  );
  assert.equal((await runMaintenance({ now })).emailed, 0);
  assert.equal(calls.length, 1);
  assert.equal(
    (await runMaintenance({ now: new Date(now.getTime() + 30_000) })).emailed,
    0,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    (await runMaintenance({ now: new Date(now.getTime() + 60_000) })).emailed,
    1,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    (calls[0].headers as Record<string, string>)["Idempotency-Key"],
    (calls[1].headers as Record<string, string>)["Idempotency-Key"],
  );
  const body = JSON.parse(calls[1].body as string);
  assert.deepEqual(body.to, ["verified@example.com"]);
  assert.ok(!body.text.includes("Tâm tư riêng tư"));
  await runMaintenance({ now: new Date(now.getTime() + 120_000) });
  assert.equal(calls.length, 2);
});

test("deleting a delivered letter removes pending email retries", async (t) => {
  const userId = addUser("verified@example.com", 1, 1);
  const letterId = addLetter(userId);
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "letters@example.com";
  process.env.APP_URL = "https://cosmic.example.com";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("{}", { status: 503 });
  });
  await runMaintenance({ now });
  assert.equal(calls, 1);
  db().prepare("DELETE FROM letters WHERE id=?").run(letterId);
  await runMaintenance({ now: new Date(now.getTime() + 60_000) });
  assert.equal(calls, 1);
  assert.equal(
    db().prepare("SELECT * FROM letter_email_outbox").all().length,
    0,
  );
});

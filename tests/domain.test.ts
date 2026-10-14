import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, closeDb } from "../src/lib/db";
import {
  createUser,
  getState,
  performAction,
  reserveAiTurn,
  releaseAiTurn,
  completeAiTurn,
  getSupportDetail,
  getConnectionDetail,
  deleteUserData,
  currentUser,
} from "../src/lib/domain";
import type { User } from "../src/lib/types";

const dir = mkdtempSync(join(tmpdir(), "cosmic-domain-"));
process.env.DATA_DIR = dir;
process.env.BACKUP_DIR = join(dir, "backups");
let alice: User, bob: User, expert: User, admin: User;
beforeEach(() => {
  db().exec("DELETE FROM users");
  alice = createUser({ name: "Alice Real", email: "alice@example.com" });
  bob = createUser({ name: "Bob Real", email: "bob@example.com" });
  expert = createUser({ name: "Expert", email: "expert@example.com" });
  admin = createUser({ name: "Admin", email: "admin@example.com" });
  db().prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  admin = currentUser(admin.id);
  performAction(admin, "admin.role", { email: expert.email, role: "expert" });
  expert = currentUser(expert.id);
});
after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
function premium(user: User) {
  db()
    .prepare("UPDATE users SET premiumUntil=? WHERE id=?")
    .run(new Date(Date.now() + 86400000).toISOString(), user.id);
  return currentUser(user.id);
}
function sendFive(user: User) {
  for (let i = 0; i < 5; i++) {
    const r = reserveAiTurn(user.id);
    completeAiTurn(
      user.id,
      r.reservationId,
      "Tâm sự " + i,
      "Mình đang lắng nghe " + i,
    );
  }
}
function entry(user: User, visibility = "private", extras = {}) {
  performAction(user, "entry.create", {
    content: "Nội dung riêng",
    mood: "sadness",
    visibility,
    ...extras,
  });
  return getState(user).entries.find((e) => e.owned)!;
}

test("private journals stay private and anonymous public posts contain no real identity", () => {
  entry(alice);
  const post = entry(alice, "public");
  const visitor = getState(null);
  assert.equal(visitor.entries.length, 1);
  assert.equal(visitor.entries[0].displayName, "Một vì sao ẩn danh");
  assert.equal(visitor.entries[0].authorId, "entry:" + post.id);
  assert.ok(!JSON.stringify(visitor).includes(alice.id));
  assert.ok(!JSON.stringify(visitor).includes(alice.name));
  assert.equal(getState(expert).entries.length, 1);
  assert.throws(() => performAction(bob, "entry.delete", { id: post.id }));
});
test("five successful AI messages enforce cooldown while failed calls release quota", () => {
  const reserved = reserveAiTurn(alice.id);
  assert.throws(() => reserveAiTurn(alice.id), /đang được xử lý/);
  releaseAiTurn(alice.id, reserved.reservationId);
  assert.equal(getState(alice).chat.remaining, 5);
  sendFive(alice);
  assert.equal(getState(alice).chat.remaining, 0);
  assert.throws(() => reserveAiTurn(alice.id), /2 tiếng/);
  db()
    .prepare("UPDATE chat_state SET cooldownUntil=? WHERE userId=?")
    .run(new Date(Date.now() - 1).toISOString(), alice.id);
  assert.equal(getState(alice).chat.remaining, 5);
  assert.ok(reserveAiTurn(alice.id).reservationId);
});
test("letters are immutable, only owner can delete, and past dates are rejected", () => {
  assert.throws(() =>
    performAction(alice, "letter.create", {
      content: "A",
      deliverAt: "2020-01-01T00:00:00Z",
    }),
  );
  performAction(alice, "letter.create", {
    content: "Tương lai",
    deliverAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const letter = getState(alice).letters[0];
  assert.equal(getState(bob).letters.length, 0);
  assert.throws(() =>
    performAction(alice, "letter.update", { id: letter.id, content: "sửa" }),
  );
  assert.throws(() => performAction(bob, "letter.delete", { id: letter.id }));
  performAction(alice, "letter.delete", { id: letter.id });
  assert.equal(getState(alice).letters.length, 0);
});
test("password groups enforce membership before publishing or reading", () => {
  performAction(alice, "group.create", {
    name: "Nhóm riêng",
    password: "secret",
  });
  const group = getState(alice).groups[0];
  entry(alice, "group", { groupId: group.id });
  assert.equal(getState(bob).entries.length, 0);
  assert.throws(() => entry(bob, "group", { groupId: group.id }));
  assert.throws(() =>
    performAction(bob, "group.join", { id: group.id, password: "wrong" }),
  );
  performAction(bob, "group.join", { id: group.id, password: "secret" });
  assert.equal(getState(bob).entries.length, 1);
});
test("staff access needs a claimed ticket, current Premium, and explicit journal sharing", () => {
  alice = premium(alice);
  entry(alice, "private", { supportVisible: true });
  entry(alice);
  sendFive(alice);
  const ticket = getState(alice).chat.ticketId!;
  assert.equal(getState(alice).chat.status, "waiting");
  assert.throws(() => getSupportDetail(expert, ticket));
  assert.throws(() => performAction(bob, "support.claim", { id: ticket }));
  performAction(expert, "support.claim", { id: ticket });
  assert.equal(getSupportDetail(expert, ticket).entries.length, 1);
  assert.equal(getSupportDetail(expert, ticket).messages.length, 10);
  performAction(expert, "support.reply", { id: ticket, content: "Mình ở đây" });
  assert.equal(getState(alice).chat.messages.at(-1)?.kind, "support");
  db()
    .prepare("UPDATE users SET premiumUntil=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", alice.id);
  assert.throws(() => getSupportDetail(expert, ticket));
  assert.throws(() =>
    performAction(expert, "support.reply", { id: ticket, content: "X" }),
  );
});
test("role changes require admin and cannot grant paid access", () => {
  assert.throws(() =>
    performAction(bob, "admin.role", { email: bob.email, role: "expert" }),
  );
  assert.throws(() =>
    performAction(admin, "admin.role", { email: bob.email, role: "admin" }),
  );
  performAction(admin, "admin.role", {
    email: bob.email,
    role: "expert",
    premiumUntil: "2099-01-01",
  });
  assert.equal(currentUser(bob.id).verified, true);
  assert.equal(currentUser(bob.id).premiumUntil, null);
});
test("connection requests use public entry handles without exposing account identity", () => {
  const post = entry(alice, "public");
  performAction(bob, "connection.request", {
    toId: "entry:" + post.id,
    name: "Người lắng nghe",
  });
  const incoming = getState(alice).requests[0];
  assert.equal(incoming.fromId, "");
  assert.equal(incoming.fromName, "Người lắng nghe");
  assert.throws(() =>
    performAction(bob, "connection.respond", { id: incoming.id, accept: true }),
  );
  performAction(alice, "connection.respond", { id: incoming.id, accept: true });
  assert.equal(getState(bob).requests[0].status, "accepted");
});
test("account deletion cascades journals, letters, sessions and pending chats", () => {
  entry(alice);
  sendFive(alice);
  performAction(alice, "letter.create", {
    content: "Thư",
    deliverAt: new Date(Date.now() + 86400000).toISOString(),
  });
  deleteUserData(alice.id);
  for (const table of ["entries", "letters", "messages", "chat_state"]) {
    assert.equal(
      db()
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE userId=?`)
        .get(alice.id)?.n,
      0,
    );
  }
  assert.throws(() => getState(alice));
});

test("peer messages require an accepted connection and participant identity", () => {
  const post = entry(alice, "public");
  performAction(bob, "connection.request", { entryId: post.id });
  const request = getState(alice).requests[0];
  assert.throws(() =>
    performAction(bob, "connection.message", {
      id: request.id,
      content: "Hello",
    }),
  );
  performAction(alice, "connection.respond", { id: request.id, accept: true });
  performAction(bob, "connection.message", {
    id: request.id,
    content: "Mình sẵn sàng lắng nghe",
  });
  const detail = getConnectionDetail(alice, request.id);
  assert.equal(detail.messages[0].kind, "peer");
  assert.ok(!JSON.stringify(detail).includes(bob.id));
  assert.equal(getConnectionDetail(bob, request.id).messages[0].kind, "self");
  assert.throws(() => getConnectionDetail(expert, request.id));
  assert.throws(() =>
    performAction(admin, "connection.message", {
      id: request.id,
      content: "No",
    }),
  );
  const another = entry(expert, "public");
  performAction(alice, "connection.request", { entryId: another.id });
  const rejected = getState(expert).requests[0];
  performAction(expert, "connection.respond", {
    id: rejected.id,
    accept: false,
  });
  assert.throws(() =>
    performAction(alice, "connection.message", {
      id: rejected.id,
      content: "No",
    }),
  );
});
test("deleting a group owner's account preserves other authors' entries privately", () => {
  performAction(alice, "group.create", { name: "Our group" });
  const group = getState(alice).groups[0];
  performAction(bob, "group.join", { id: group.id });
  const post = entry(bob, "group", { groupId: group.id });
  deleteUserData(alice.id);
  const retained = getState(bob).entries.find((e) => e.id === post.id)!;
  assert.equal(retained.visibility, "private");
  assert.equal(retained.groupId, null);
});

test("expired Premium returns to AI quota and revoking staff role removes ticket access", () => {
  alice = premium(alice);
  sendFive(alice);
  const ticket = getState(alice).chat.ticketId!;
  performAction(expert, "support.claim", { id: ticket });
  performAction(admin, "admin.role", { email: expert.email, role: "user" });
  assert.throws(() => getSupportDetail(expert, ticket));
  assert.throws(() =>
    performAction(expert, "support.reply", { id: ticket, content: "No" }),
  );
  assert.equal(getState(alice).chat.status, "waiting");
  db()
    .prepare("UPDATE users SET premiumUntil=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", alice.id);
  assert.equal(getState(alice).chat.status, "ai");
  assert.equal(getState(alice).chat.ticketId, null);
  assert.throws(() => reserveAiTurn(alice.id), /2 tiếng/);
  db()
    .prepare("UPDATE chat_state SET cooldownUntil=? WHERE userId=?")
    .run("2020-01-01T00:00:00.000Z", alice.id);
  assert.ok(reserveAiTurn(alice.id).reservationId);
});
test("chat history returns most recent 500 messages in insertion order", () => {
  const insert = db().prepare(
    "INSERT INTO messages(id,userId,kind,content,createdAt) VALUES(?,?,?,?,?)",
  );
  for (let i = 0; i < 505; i++)
    insert.run(
      "message-" + i,
      alice.id,
      "user",
      String(i),
      "2026-10-14T00:00:00.000Z",
    );
  const messages = getState(alice).chat.messages;
  assert.equal(messages.length, 500);
  assert.equal(messages[0].content, "5");
  assert.equal(messages.at(-1)?.content, "504");
});

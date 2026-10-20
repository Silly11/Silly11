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
  const existing = new Set(getState(user).entries.map((e) => e.id));
  performAction(user, "entry.create", {
    content: "Nội dung riêng",
    mood: "sadness",
    visibility,
    ...extras,
  });
  return getState(user).entries.find((e) => e.owned && !existing.has(e.id))!;
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
test("planet destinations persist independently from visibility and reject unknown planets", () => {
  const legacy = entry(alice);
  assert.equal(legacy.planetId, "earth");
  const mars = entry(alice, "public", { planetId: "mars" });
  const earth = entry(alice, "private", { planetId: "earth" });
  assert.equal(
    getState(null).entries.find((e) => e.id === mars.id)?.planetId,
    "mars",
  );
  assert.ok(getState(bob).entries.every((e) => e.id !== earth.id));
  for (const planetId of ["pluto", "", null, 42]) {
    assert.throws(() => entry(alice, "public", { planetId }), {
      name: "ZodError",
    });
  }
  assert.equal(getState(alice).entries.length, 3);
  const saved = getState(alice).entries.find((e) => e.id === mars.id)!;
  assert.equal(saved.planetId, "mars");
  assert.equal(saved.content, mars.content);
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
test("group deletion preserves every author's journals privately and leaves other entries unchanged", () => {
  performAction(alice, "group.create", { name: "Our group" });
  const group = getState(alice).groups[0];
  performAction(bob, "group.join", { id: group.id });
  const alicePost = entry(alice, "group", {
    groupId: group.id,
    content: "Alice's journal",
    identity: "real",
  });
  const bobPost = entry(bob, "group", {
    groupId: group.id,
    content: "Bob's journal",
    planetId: "mars",
    mood: "unsaid",
  });
  // Even legacy/stale sharing flags must be cleared on conversion to private.
  db()
    .prepare("UPDATE entries SET supportVisible=1 WHERE id=?")
    .run(bobPost.id);
  performAction(alice, "group.create", { name: "Another group" });
  const otherGroup = getState(alice).groups.find((g) => g.id !== group.id)!;
  const otherPost = entry(alice, "group", { groupId: otherGroup.id });
  const publicPost = entry(bob, "public");
  const privatePost = entry(alice);
  const journalRows = () =>
    db()
      .prepare("SELECT * FROM entries ORDER BY id")
      .all()
      .map((post) => ({ ...post }));
  const before = journalRows();

  performAction(alice, "group.delete", { id: group.id });

  assert.deepEqual(
    journalRows(),
    before.map((post) =>
      post.groupId === group.id
        ? { ...post, groupId: null, visibility: "private", supportVisible: 0 }
        : post,
    ),
  );
  assert.equal(
    db().prepare("SELECT id FROM groups WHERE id=?").get(group.id),
    undefined,
  );
  assert.equal(
    db()
      .prepare("SELECT COUNT(*) n FROM group_members WHERE groupId=?")
      .get(group.id)?.n,
    0,
  );
  assert.deepEqual(
    getState(alice).entries.find((e) => e.id === alicePost.id),
    {
      ...alicePost,
      visibility: "private",
      groupId: null,
      supportVisible: false,
    },
  );
  assert.deepEqual(
    getState(bob).entries.find((e) => e.id === bobPost.id),
    {
      ...bobPost,
      visibility: "private",
      groupId: null,
      supportVisible: false,
    },
  );
  assert.ok(getState(alice).entries.some((e) => e.id === otherPost.id));
  assert.ok(getState(alice).entries.some((e) => e.id === privatePost.id));
  for (const viewer of [alice, bob, expert, admin, null]) {
    const state = getState(viewer);
    assert.ok(state.groups.every((g) => g.id !== group.id));
    for (const post of [alicePost, bobPost]) {
      if (viewer?.id !== (post.id === alicePost.id ? alice.id : bob.id))
        assert.ok(state.entries.every((e) => e.id !== post.id));
    }
    assert.ok(state.entries.some((e) => e.id === publicPost.id));
  }
  assert.throws(() => entry(bob, "group", { groupId: group.id }), {
    status: 403,
  });
  assert.throws(() => performAction(bob, "group.join", { id: group.id }), {
    status: 404,
  });
});

test("members, outsiders and staff cannot delete someone else's group or change its journals", () => {
  performAction(alice, "group.create", {
    name: "Owner only",
    password: "secret",
  });
  const group = getState(alice).groups[0];
  performAction(bob, "group.join", { id: group.id, password: "secret" });
  entry(bob, "group", { groupId: group.id });
  const snapshot = () => ({
    groups: db().prepare("SELECT * FROM groups").all(),
    entries: db().prepare("SELECT * FROM entries").all(),
    members: db().prepare("SELECT * FROM group_members").all(),
  });
  const before = snapshot();
  for (const user of [bob, expert, admin]) {
    assert.throws(() => performAction(user, "group.delete", { id: group.id }), {
      status: 403,
    });
    assert.deepEqual(snapshot(), before);
  }
});

test("owner can delete an empty group; missing or malformed group identifiers are rejected", () => {
  performAction(alice, "group.create", { name: "Empty group" });
  const group = getState(alice).groups[0];
  for (const payload of [{}, { id: "" }, { id: null }, { id: 42 }]) {
    assert.throws(() => performAction(alice, "group.delete", payload), {
      name: "ZodError",
    });
    assert.equal(getState(alice).groups.length, 1);
  }
  performAction(alice, "group.delete", { id: group.id });
  assert.equal(getState(alice).groups.length, 0);
  assert.throws(() => performAction(alice, "group.delete", { id: group.id }), {
    status: 404,
  });
});

test("failed group deletion rolls back journal privacy and membership changes together", () => {
  performAction(alice, "group.create", { name: "Atomic deletion" });
  const group = getState(alice).groups[0];
  performAction(bob, "group.join", { id: group.id });
  const post = entry(bob, "group", { groupId: group.id });
  db().exec(`CREATE TEMP TRIGGER fail_group_delete BEFORE DELETE ON groups
    BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;`);
  try {
    assert.throws(
      () => performAction(alice, "group.delete", { id: group.id }),
      /simulated storage failure/,
    );
    assert.deepEqual(
      getState(bob).entries.find((e) => e.id === post.id),
      post,
    );
    assert.equal(getState(bob).groups[0].memberCount, 2);
    assert.equal(getState(alice).groups[0].joined, true);
  } finally {
    db().exec("DROP TRIGGER fail_group_delete");
  }
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

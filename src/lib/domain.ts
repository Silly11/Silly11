import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { db, transaction, checkpointDeletedData } from "./db";
import {
  purgeUserBackups,
  deliverDueLetters,
  backupRetentionDays,
} from "./maintenance";
import type {
  AppState,
  User,
  Entry,
  ChatMessage,
  SupportTicket,
} from "./types";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = () => randomUUID();
const text = z.string().trim().min(1).max(10000);
const identifier = z.string().min(1).max(160);
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new DomainError(message, status);
}
export function isPremium(user: Pick<User, "premiumUntil">): boolean {
  return !!user.premiumUntil && Date.parse(user.premiumUntil) > Date.now();
}
export function userFromRow(row: Row): User {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as User["role"],
    premiumUntil: row.premiumUntil as string | null,
    verified: !!row.verified,
  };
}
export function currentUser(userId: string): User {
  const row = db().prepare("SELECT * FROM users WHERE id=?").get(userId);
  if (!row) fail("Tài khoản không tồn tại.", 401);
  return userFromRow(row);
}
function notice(userId: string, message: string) {
  db()
    .prepare(
      "INSERT INTO notifications (id,userId,text,createdAt) VALUES (?,?,?,?)",
    )
    .run(id(), userId, message, now());
}
function staff(user: User) {
  if (user.role !== "admin" && !(user.role === "expert" && user.verified))
    fail("Bạn không có quyền hỗ trợ.", 403);
}
function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
function passwordMatches(password: string, hash: string) {
  const [salt, value] = hash.split(":");
  const expected = Buffer.from(value, "hex");
  const actual = scryptSync(password, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function mapEntry(row: Row, user: User | null): Entry {
  return {
    id: String(row.id),
    authorId: row.userId === user?.id ? String(row.userId) : "entry:" + row.id,
    displayName: String(row.displayName),
    mood: row.mood as Entry["mood"],
    content: String(row.content),
    visibility: row.visibility as Entry["visibility"],
    groupId: row.groupId as string | null,
    createdAt: String(row.createdAt),
    owned: row.userId === user?.id,
    authorPremium:
      !!row.premiumUntil && Date.parse(String(row.premiumUntil)) > Date.now(),
    supportVisible: !!row.supportVisible,
  };
}
function ensureChat(userId: string) {
  db()
    .prepare("INSERT OR IGNORE INTO chat_state (userId) VALUES (?)")
    .run(userId);
}
function refreshQuota(userId: string) {
  ensureChat(userId);
  db()
    .prepare(
      "UPDATE chat_state SET used=0,cooldownUntil=NULL WHERE userId=? AND cooldownUntil IS NOT NULL AND cooldownUntil<=?",
    )
    .run(userId, now());
}
function openTicket(userId: string): Row | undefined {
  return db()
    .prepare("SELECT * FROM tickets WHERE userId=? AND status!='closed'")
    .get(userId);
}
function queueSupport(user: User): string {
  const existing = openTicket(user.id);
  if (existing) return String(existing.id);
  const ticketId = id();
  db()
    .prepare("INSERT INTO tickets (id,userId,createdAt) VALUES (?,?,?)")
    .run(ticketId, user.id, now());
  notice(
    user.id,
    "Bạn đang chờ người hỗ trợ. Thời gian phản hồi dự kiến tối đa 1 tiếng.",
  );
  return ticketId;
}
function mapTicket(row: Row): SupportTicket {
  return {
    id: String(row.id),
    userId: String(row.userId),
    name: String(row.name),
    createdAt: String(row.createdAt),
    status: row.status as SupportTicket["status"],
    assignedTo: row.assignedTo as string | null,
    overdue:
      row.status === "waiting" &&
      Date.now() - Date.parse(String(row.createdAt)) > 3600000,
  };
}
function authorizedTicket(user: User, ticketId: string): Row {
  staff(user);
  const ticket = db()
    .prepare(
      "SELECT t.*,u.name,u.premiumUntil FROM tickets t JOIN users u ON u.id=t.userId WHERE t.id=?",
    )
    .get(ticketId);
  if (
    !ticket ||
    !isPremium({ premiumUntil: ticket.premiumUntil as string | null })
  )
    fail("Yêu cầu hỗ trợ không khả dụng.", 404);
  if (
    ticket.assignedTo &&
    ticket.assignedTo !== user.id &&
    user.role !== "admin"
  )
    fail("Yêu cầu đã được người khác tiếp nhận.", 403);
  return ticket;
}

export function getState(input: User | null): AppState {
  deliverDueLetters();
  const user = input ? currentUser(input.id) : null;
  const rows = user
    ? db()
        .prepare(
          `SELECT e.*,u.premiumUntil FROM entries e JOIN users u ON u.id=e.userId WHERE e.userId=? OR e.visibility='public' OR (e.visibility='group' AND EXISTS(SELECT 1 FROM group_members m WHERE m.groupId=e.groupId AND m.userId=?)) ORDER BY e.createdAt DESC LIMIT 300`,
        )
        .all(user.id, user.id)
    : db()
        .prepare(
          "SELECT e.*,u.premiumUntil FROM entries e JOIN users u ON u.id=e.userId WHERE e.visibility='public' ORDER BY e.createdAt DESC LIMIT 100",
        )
        .all();
  const state: AppState = {
    user,
    entries: rows.map((r) => mapEntry(r, user)),
    letters: [],
    chat: {
      messages: [],
      remaining: 5,
      cooldownUntil: null,
      status: "ai",
      ticketId: null,
    },
    notifications: [],
    groups: [],
    requests: [],
    staffQueue: [],
    config: {
      aiEnabled: !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL,
      billingEnabled:
        !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID,
      oauthProviders: [],
      backupRetentionDays: backupRetentionDays(),
    },
  };
  state.groups = db()
    .prepare(
      `SELECT g.id,g.name,g.ownerId,g.passwordHash,(SELECT COUNT(*) FROM group_members m WHERE m.groupId=g.id) memberCount,EXISTS(SELECT 1 FROM group_members m WHERE m.groupId=g.id AND m.userId=?) joined FROM groups g ORDER BY g.createdAt DESC LIMIT 100`,
    )
    .all(user?.id || "")
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      ownerId: r.joined ? String(r.ownerId) : "",
      locked: !!r.passwordHash,
      joined: !!r.joined,
      memberCount: Number(r.memberCount),
    }));
  if (!user) return state;
  refreshQuota(user.id);
  const quota = db()
    .prepare("SELECT * FROM chat_state WHERE userId=?")
    .get(user.id)!;
  let ticket = openTicket(user.id);
  if (isPremium(user) && Number(quota.used) >= 5 && !ticket) {
    queueSupport(user);
    ticket = openTicket(user.id);
  }
  state.chat = {
    messages: db()
      .prepare(
        "SELECT id,kind,content,createdAt FROM (SELECT rowid AS seq,id,kind,content,createdAt FROM messages WHERE userId=? ORDER BY rowid DESC LIMIT 500) ORDER BY seq",
      )
      .all(user.id) as unknown as ChatMessage[],
    remaining: Math.max(0, 5 - Number(quota.used)),
    cooldownUntil: quota.cooldownUntil as string | null,
    status:
      ticket && isPremium(user) ? (ticket.status as "waiting" | "human") : "ai",
    ticketId: ticket && isPremium(user) ? String(ticket.id) : null,
  };
  state.letters = db()
    .prepare(
      "SELECT id,content,deliverAt,status,createdAt FROM letters WHERE userId=? ORDER BY deliverAt",
    )
    .all(user.id) as unknown as AppState["letters"];
  state.notifications = db()
    .prepare(
      "SELECT id,text,read,createdAt FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 100",
    )
    .all(user.id)
    .map((r) => ({
      id: String(r.id),
      text: String(r.text),
      read: !!r.read,
      createdAt: String(r.createdAt),
    }));
  state.requests = db()
    .prepare(
      "SELECT * FROM connection_requests WHERE fromId=? OR toId=? ORDER BY createdAt DESC LIMIT 100",
    )
    .all(user.id, user.id)
    .map((r) => ({
      id: String(r.id),
      fromId: r.fromId === user.id ? user.id : "",
      fromName: String(r.fromName),
      toId: r.toId === user.id ? user.id : "",
      status: r.status as "pending" | "accepted" | "rejected",
      incoming: r.toId === user.id,
    }));
  if (user.role === "admin" || (user.role === "expert" && user.verified))
    state.staffQueue = db()
      .prepare(
        `SELECT t.*,u.name FROM tickets t JOIN users u ON u.id=t.userId WHERE t.status!='closed' AND u.premiumUntil>? AND (t.assignedTo IS NULL OR t.assignedTo=? OR ?='admin') ORDER BY t.createdAt LIMIT 100`,
      )
      .all(now(), user.id, user.role)
      .map(mapTicket);
  return state;
}

export function getSupportDetail(input: User, ticketId: string) {
  const user = currentUser(input.id);
  const ticket = authorizedTicket(user, ticketId);
  if (ticket.status !== "human")
    fail("Hãy tiếp nhận yêu cầu trước khi xem nội dung.", 403);
  const entries = db()
    .prepare(
      "SELECT e.*,u.premiumUntil FROM entries e JOIN users u ON u.id=e.userId WHERE e.userId=? AND e.visibility='private' AND e.supportVisible=1 ORDER BY e.createdAt DESC LIMIT 100",
    )
    .all(String(ticket.userId))
    .map((r) => mapEntry(r, user));
  const messages = db()
    .prepare(
      "SELECT id,kind,content,createdAt FROM (SELECT rowid AS seq,id,kind,content,createdAt FROM messages WHERE userId=? AND (ticketId=? OR kind='ai' OR (kind='user' AND ticketId IS NULL)) ORDER BY rowid DESC LIMIT 500) ORDER BY seq",
    )
    .all(String(ticket.userId), ticketId) as unknown as ChatMessage[];
  return { ticket: mapTicket(ticket), entries, messages };
}

export function reserveAiTurn(userId: string): {
  reservationId: string;
  remaining: number;
} {
  return transaction(() => {
    const user = currentUser(userId);
    refreshQuota(userId);
    const q = db()
      .prepare("SELECT * FROM chat_state WHERE userId=?")
      .get(userId)!;
    if (isPremium(user) && openTicket(userId))
      fail("Bạn đang chờ hoặc trò chuyện với người hỗ trợ.", 409);
    if (Number(q.used) >= 5)
      fail(
        "Bạn đã dùng hết 5 tin nhắn. Hãy chờ 2 tiếng hoặc nâng cấp Premium.",
        429,
      );
    if (
      q.reservationId &&
      Date.now() - Date.parse(String(q.reservedAt)) < 120000
    )
      fail("Tin nhắn trước đang được xử lý.", 409);
    const reservationId = id();
    db()
      .prepare(
        "UPDATE chat_state SET reservationId=?,reservedAt=? WHERE userId=?",
      )
      .run(reservationId, now(), userId);
    return { reservationId, remaining: 5 - Number(q.used) };
  });
}
export function releaseAiTurn(userId: string, reservationId: string) {
  db()
    .prepare(
      "UPDATE chat_state SET reservationId=NULL,reservedAt=NULL WHERE userId=? AND reservationId=?",
    )
    .run(userId, reservationId);
}
export function completeAiTurn(
  userId: string,
  reservationId: string,
  userText: string,
  aiText: string,
): void {
  text.parse(userText);
  z.string().min(1).max(30000).parse(aiText);
  transaction(() => {
    const user = currentUser(userId);
    const q = db()
      .prepare("SELECT * FROM chat_state WHERE userId=? AND reservationId=?")
      .get(userId, reservationId);
    if (!q) fail("Lượt gửi đã hết hạn. Hãy thử lại.", 409);
    const used = Number(q.used) + 1;
    const timestamp = now();
    db()
      .prepare(
        "UPDATE chat_state SET used=?,cooldownUntil=?,reservationId=NULL,reservedAt=NULL WHERE userId=?",
      )
      .run(
        used,
        used >= 5 ? new Date(Date.now() + 7200000).toISOString() : null,
        userId,
      );
    const insert = db().prepare(
      "INSERT INTO messages (id,userId,kind,content,createdAt) VALUES (?,?,?,?,?)",
    );
    insert.run(id(), userId, "user", userText, timestamp);
    insert.run(
      id(),
      userId,
      "ai",
      aiText,
      new Date(Date.now() + 1).toISOString(),
    );
    if (used >= 5 && isPremium(user)) queueSupport(user);
  });
}
export function sendHumanMessage(input: User, content: string): void {
  const user = currentUser(input.id);
  const value = text.parse(content);
  if (!isPremium(user)) fail("Cần gói Premium đang hoạt động.", 403);
  transaction(() => {
    const ticket = openTicket(user.id);
    if (!ticket) fail("Chưa có yêu cầu hỗ trợ.", 409);
    db()
      .prepare(
        "INSERT INTO messages (id,userId,kind,content,ticketId,createdAt) VALUES (?,?,?,?,?,?)",
      )
      .run(id(), user.id, "user", value, String(ticket.id), now());
  });
}

function acceptedConnection(user: User, requestId: string): Row {
  const request = db()
    .prepare(
      "SELECT * FROM connection_requests WHERE id=? AND status='accepted' AND (fromId=? OR toId=?)",
    )
    .get(requestId, user.id, user.id);
  if (!request) fail("Cuộc trò chuyện không khả dụng.", 404);
  return request;
}
export function getConnectionDetail(input: User, requestId: string) {
  const user = currentUser(input.id);
  acceptedConnection(user, requestId);
  const rows = db()
    .prepare(
      "SELECT senderId,id,content,createdAt FROM (SELECT rowid AS seq,* FROM peer_messages WHERE requestId=? ORDER BY rowid DESC LIMIT 500) ORDER BY seq",
    )
    .all(requestId);
  return {
    id: requestId,
    messages: rows.map((r) => ({
      id: String(r.id),
      kind: r.senderId === user.id ? "self" : "peer",
      content: String(r.content),
      createdAt: String(r.createdAt),
    })),
  };
}

export function performAction(
  input: User,
  action: string,
  payload: unknown,
): void {
  const user = currentUser(input.id);
  switch (action) {
    case "entry.create": {
      const p = z
        .object({
          content: text,
          mood: z.enum(["joy", "sadness", "unsaid"]),
          visibility: z.enum(["private", "public", "group"]),
          identity: z
            .enum(["anonymous", "nickname", "real"])
            .default("anonymous"),
          nickname: z.string().trim().max(60).optional(),
          groupId: identifier.nullable().optional(),
          supportVisible: z.boolean().default(false),
        })
        .parse(payload);
      if (
        p.visibility === "group" &&
        (!p.groupId ||
          !db()
            .prepare("SELECT 1 FROM group_members WHERE groupId=? AND userId=?")
            .get(p.groupId, user.id))
      )
        fail("Bạn chưa tham gia nhóm này.", 403);
      if (p.supportVisible && !isPremium(user))
        fail("Chia sẻ với đội hỗ trợ dành cho Premium.", 403);
      const displayName =
        p.identity === "real"
          ? user.name
          : p.identity === "nickname"
            ? p.nickname?.trim()
            : "Một vì sao ẩn danh";
      if (!displayName) fail("Hãy nhập biệt danh.");
      db()
        .prepare(
          "INSERT INTO entries (id,userId,displayName,mood,content,visibility,groupId,supportVisible,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          user.id,
          displayName,
          p.mood,
          p.content,
          p.visibility,
          p.visibility === "group" ? p.groupId! : null,
          p.visibility === "private" && p.supportVisible ? 1 : 0,
          now(),
        );
      return;
    }
    case "entry.delete": {
      const p = z.object({ id: identifier }).parse(payload);
      transaction(() => {
        if (
          !db()
            .prepare("SELECT id FROM entries WHERE id=? AND userId=?")
            .get(p.id, user.id)
        )
          fail("Không tìm thấy tâm tư.", 404);
        purgeUserBackups(user.id);
        db()
          .prepare("DELETE FROM entries WHERE id=? AND userId=?")
          .run(p.id, user.id);
      });
      checkpointDeletedData();
      return;
    }
    case "letter.create": {
      const p = z
        .object({
          content: text,
          deliverAt: z.string().datetime({ offset: true }),
        })
        .parse(payload);
      const date = new Date(p.deliverAt);
      if (date.getTime() <= Date.now()) fail("Ngày nhận thư phải ở tương lai.");
      db()
        .prepare(
          "INSERT INTO letters (id,userId,content,deliverAt,createdAt) VALUES (?,?,?,?,?)",
        )
        .run(id(), user.id, p.content, date.toISOString(), now());
      return;
    }
    case "letter.delete": {
      const p = z.object({ id: identifier }).parse(payload);
      transaction(() => {
        if (
          !db()
            .prepare("SELECT id FROM letters WHERE id=? AND userId=?")
            .get(p.id, user.id)
        )
          fail("Không tìm thấy thư.", 404);
        purgeUserBackups(user.id);
        db()
          .prepare("DELETE FROM notifications WHERE id=? AND userId=?")
          .run("letter:" + p.id, user.id);
        db()
          .prepare("DELETE FROM letters WHERE id=? AND userId=?")
          .run(p.id, user.id);
      });
      checkpointDeletedData();
      return;
    }
    case "notifications.read":
      db()
        .prepare("UPDATE notifications SET read=1 WHERE userId=?")
        .run(user.id);
      return;
    case "group.create": {
      const p = z
        .object({
          name: z.string().trim().min(2).max(80),
          password: z.string().min(4).max(128).optional().or(z.literal("")),
        })
        .parse(payload);
      transaction(() => {
        const groupId = id();
        db()
          .prepare(
            "INSERT INTO groups (id,name,ownerId,passwordHash,createdAt) VALUES (?,?,?,?,?)",
          )
          .run(
            groupId,
            p.name,
            user.id,
            p.password ? hashPassword(p.password) : null,
            now(),
          );
        db()
          .prepare("INSERT INTO group_members (groupId,userId) VALUES (?,?)")
          .run(groupId, user.id);
      });
      return;
    }
    case "group.join": {
      const p = z
        .object({ id: identifier, password: z.string().max(128).optional() })
        .parse(payload);
      const group = db().prepare("SELECT * FROM groups WHERE id=?").get(p.id);
      if (!group) fail("Nhóm không tồn tại.", 404);
      if (
        group.passwordHash &&
        !passwordMatches(p.password || "", String(group.passwordHash))
      )
        fail("Mật khẩu nhóm không đúng.", 403);
      db()
        .prepare(
          "INSERT OR IGNORE INTO group_members (groupId,userId) VALUES (?,?)",
        )
        .run(p.id, user.id);
      return;
    }
    case "connection.request": {
      const p = z
        .object({
          entryId: identifier.optional(),
          toId: identifier.optional(),
          name: z.string().trim().min(1).max(60).optional(),
        })
        .parse(payload);
      const entryId = p.entryId || p.toId?.replace(/^entry:/, "");
      if (!entryId) fail("Hãy chọn tâm tư muốn kết nối.");
      const entry = db()
        .prepare(
          `SELECT e.* FROM entries e WHERE e.id=? AND (e.visibility='public' OR (e.visibility='group' AND EXISTS(SELECT 1 FROM group_members m WHERE m.groupId=e.groupId AND m.userId=?)))`,
        )
        .get(entryId, user.id);
      if (!entry || entry.userId === user.id)
        fail("Không thể gửi lời mời này.");
      transaction(() => {
        const existing = db()
          .prepare(
            "SELECT status FROM connection_requests WHERE fromId=? AND toId=?",
          )
          .get(user.id, String(entry.userId));
        if (existing) fail("Bạn đã gửi lời mời đến người này.", 409);
        db()
          .prepare(
            "INSERT INTO connection_requests (id,fromId,toId,fromName,createdAt) VALUES (?,?,?,?,?)",
          )
          .run(
            id(),
            user.id,
            String(entry.userId),
            p.name || "Một người muốn lắng nghe",
            now(),
          );
        notice(
          String(entry.userId),
          "Bạn có một lời mời kết nối trong Tin nhắn chờ.",
        );
      });
      return;
    }
    case "connection.respond": {
      const p = z
        .object({ id: identifier, accept: z.boolean() })
        .parse(payload);
      transaction(() => {
        const request = db()
          .prepare(
            "SELECT * FROM connection_requests WHERE id=? AND toId=? AND status='pending'",
          )
          .get(p.id, user.id);
        if (!request) fail("Lời mời không khả dụng.", 404);
        db()
          .prepare("UPDATE connection_requests SET status=? WHERE id=?")
          .run(p.accept ? "accepted" : "rejected", p.id);
        notice(
          String(request.fromId),
          p.accept
            ? "Lời mời kết nối của bạn đã được chấp nhận."
            : "Lời mời kết nối của bạn đã được từ chối.",
        );
      });
      return;
    }
    case "connection.message": {
      const p = z.object({ id: identifier, content: text }).parse(payload);
      transaction(() => {
        const request = acceptedConnection(user, p.id);
        db()
          .prepare(
            "INSERT INTO peer_messages (id,requestId,senderId,content,createdAt) VALUES (?,?,?,?,?)",
          )
          .run(id(), p.id, user.id, p.content, now());
        notice(
          String(request.fromId === user.id ? request.toId : request.fromId),
          "Bạn có tin nhắn mới từ một người đã kết nối.",
        );
      });
      return;
    }
    case "support.claim": {
      const p = z.object({ id: identifier }).parse(payload);
      transaction(() => {
        authorizedTicket(user, p.id);
        const changed = db()
          .prepare(
            "UPDATE tickets SET status='human',assignedTo=? WHERE id=? AND status='waiting' AND assignedTo IS NULL",
          )
          .run(user.id, p.id).changes;
        if (!changed) fail("Yêu cầu đã được tiếp nhận.", 409);
      });
      return;
    }
    case "support.reply": {
      const p = z.object({ id: identifier, content: text }).parse(payload);
      transaction(() => {
        const ticket = authorizedTicket(user, p.id);
        if (ticket.status !== "human")
          fail("Hãy tiếp nhận yêu cầu trước.", 409);
        db()
          .prepare(
            "INSERT INTO messages (id,userId,kind,content,ticketId,createdAt) VALUES (?,?,?,?,?,?)",
          )
          .run(id(), String(ticket.userId), "support", p.content, p.id, now());
        notice(
          String(ticket.userId),
          "Người hỗ trợ đã phản hồi tâm tư của bạn.",
        );
      });
      return;
    }
    case "support.close": {
      const p = z.object({ id: identifier }).parse(payload);
      transaction(() => {
        const ticket = authorizedTicket(user, p.id);
        db()
          .prepare("UPDATE tickets SET status='closed',closedAt=? WHERE id=?")
          .run(now(), p.id);
        db()
          .prepare(
            "UPDATE chat_state SET used=0,cooldownUntil=NULL WHERE userId=?",
          )
          .run(String(ticket.userId));
        notice(String(ticket.userId), "Cuộc trò chuyện hỗ trợ đã kết thúc.");
      });
      return;
    }
    case "admin.role": {
      if (user.role !== "admin") fail("Chỉ nhà phát hành được cấp quyền.", 403);
      const p = z
        .object({ email: z.string().email(), role: z.enum(["user", "expert"]) })
        .parse(payload);
      const target = db()
        .prepare("SELECT * FROM users WHERE email=?")
        .get(p.email);
      if (!target || target.role === "admin")
        fail("Không thể thay đổi tài khoản này.", 403);
      transaction(() => {
        db()
          .prepare("UPDATE users SET role=?,verified=? WHERE id=?")
          .run(p.role, p.role === "expert" ? 1 : 0, String(target.id));
        if (p.role === "user")
          db()
            .prepare(
              "UPDATE tickets SET assignedTo=NULL,status='waiting' WHERE assignedTo=? AND status='human'",
            )
            .run(String(target.id));
      });
      return;
    }
    default:
      fail("Thao tác không được hỗ trợ.", 400);
  }
}
export function deleteUserData(userId: string): void {
  transaction(() => {
    purgeUserBackups(userId);
    db()
      .prepare(
        "UPDATE entries SET groupId=NULL,visibility='private',supportVisible=0 WHERE userId!=? AND groupId IN (SELECT id FROM groups WHERE ownerId=?)",
      )
      .run(userId, userId);
    db()
      .prepare(
        "UPDATE tickets SET assignedTo=NULL,status='waiting' WHERE assignedTo=? AND status='human'",
      )
      .run(userId);
    db().prepare("DELETE FROM users WHERE id=?").run(userId);
  });
  checkpointDeletedData();
}

export function createUser(values: {
  name: string;
  email: string;
  passwordHash?: string | null;
}): User {
  const name = z.string().trim().min(1).max(80).parse(values.name);
  const email = z.string().email().max(254).parse(values.email).toLowerCase();
  const userId = id();
  db()
    .prepare(
      "INSERT INTO users (id,name,email,passwordHash,createdAt) VALUES (?,?,?,?,?)",
    )
    .run(userId, name, email, values.passwordHash || null, now());
  return currentUser(userId);
}

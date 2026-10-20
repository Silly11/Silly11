import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { authDb } from "./auth";
import { transaction } from "./db";
import { HttpError } from "./http";
import type { User } from "./types";

const initialized = new WeakSet<object>();
function billingDb() {
  const sql = authDb();
  if (!initialized.has(sql)) {
    sql.exec(`CREATE TABLE IF NOT EXISTS billing_accounts(userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,customerId TEXT NOT NULL UNIQUE,subscriptionId TEXT,status TEXT NOT NULL DEFAULT 'none');
      CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY,processedAt TEXT NOT NULL);`);
    const columns = new Set(
      sql
        .prepare("PRAGMA table_info(billing_accounts)")
        .all()
        .map((column) => column.name),
    );
    for (const [name, type] of Object.entries({
      checkoutKey: "TEXT",
      checkoutCreatedAt: "INTEGER",
      checkoutId: "TEXT",
      checkoutUrl: "TEXT",
      checkoutExpiresAt: "INTEGER",
      deletionPending: "INTEGER NOT NULL DEFAULT 0",
    })) {
      if (!columns.has(name))
        sql.exec(`ALTER TABLE billing_accounts ADD COLUMN ${name} ${type}`);
    }
    initialized.add(sql);
  }
  return sql;
}
export function billingEnabled() {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.APP_URL
  );
}
async function stripe(
  path: string,
  body?: URLSearchParams,
  idempotency?: string,
  method?: "DELETE",
) {
  if (!billingEnabled())
    throw new HttpError(
      503,
      "Thanh toán chưa được cấu hình. Gói Premium chưa được mở bán.",
    );
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2025-04-30.basil",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(502, "Chưa thể kết nối thanh toán. Vui lòng thử lại.");
  return response.json();
}
interface Subscription {
  id: string;
  customer: string | { id: string };
  status: string;
  current_period_end?: number;
  items?: {
    data?: {
      current_period_end?: number;
      price?: {
        unit_amount?: number;
        currency?: string;
        recurring?: { interval?: string; interval_count?: number };
      };
    }[];
  };
}
async function listCustomerSubscriptions(
  customerId: string,
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];
  let after = "";
  do {
    const page = await stripe(
      `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`,
    );
    if (!Array.isArray(page.data))
      throw new HttpError(502, "Dữ liệu thanh toán chưa hợp lệ.");
    subscriptions.push(...page.data);
    if (!page.has_more) break;
    const next = page.data.at(-1)?.id;
    if (typeof next !== "string" || next === after)
      throw new HttpError(502, "Chưa thể kiểm tra đăng ký thanh toán.");
    after = next;
  } while (true);
  return subscriptions;
}
function isOngoing(subscription: Subscription) {
  return !["canceled", "incomplete_expired"].includes(subscription.status);
}
function currentAccount(userId: string) {
  const account = billingDb()
    .prepare("SELECT * FROM billing_accounts WHERE userId=?")
    .get(userId);
  if (!account || account.deletionPending)
    throw new HttpError(
      409,
      "Tài khoản đang được xóa. Không thể mở thanh toán mới.",
    );
  return account;
}
export async function createCheckout(user: User) {
  if (!billingEnabled())
    throw new HttpError(
      503,
      "Thanh toán chưa được cấu hình. Gói Premium chưa được mở bán.",
    );
  const sql = billingDb();
  let account = sql
    .prepare("SELECT * FROM billing_accounts WHERE userId=?")
    .get(user.id);
  if (!account) {
    const customer = await stripe(
      "customers",
      new URLSearchParams({ email: user.email, "metadata[userId]": user.id }),
      `customer-${user.id}`,
    );
    sql
      .prepare(
        "INSERT OR IGNORE INTO billing_accounts(userId,customerId) VALUES(?,?)",
      )
      .run(user.id, customer.id);
  }
  account = currentAccount(user.id);
  const subscriptions = await listCustomerSubscriptions(
    String(account.customerId),
  );
  account = currentAccount(user.id);
  if (subscriptions.some(isOngoing))
    throw new HttpError(
      409,
      "Bạn đã có đăng ký đang xử lý. Hãy mở Quản lý gói.",
    );
  const reserved = transaction(() => {
    const current = currentAccount(user.id);
    const now = Math.floor(Date.now() / 1000);
    // A durable reservation, not a wall-clock bucket: concurrent requests and retries
    // reuse identical Stripe parameters until this specific checkout expires.
    if (!current.checkoutKey || Number(current.checkoutExpiresAt) <= now) {
      sql
        .prepare(
          "UPDATE billing_accounts SET checkoutKey=?,checkoutCreatedAt=?,checkoutExpiresAt=?,checkoutId=NULL,checkoutUrl=NULL WHERE userId=?",
        )
        .run(randomUUID(), now, now + 3600, user.id);
    }
    return currentAccount(user.id);
  });
  if (reserved.checkoutId && reserved.checkoutUrl) {
    const existing = await stripe(
      `checkout/sessions/${encodeURIComponent(String(reserved.checkoutId))}`,
    );
    currentAccount(user.id);
    if (existing.status === "open")
      return { url: String(reserved.checkoutUrl) };
    sql
      .prepare(
        "UPDATE billing_accounts SET checkoutKey=NULL,checkoutId=NULL,checkoutUrl=NULL,checkoutExpiresAt=NULL WHERE userId=? AND checkoutKey=?",
      )
      .run(user.id, String(reserved.checkoutKey));
    // A checkout may have completed since the first subscription lookup. Starting
    // again rechecks paid/pending subscriptions before reserving another session.
    return createCheckout(user);
  }
  const params = new URLSearchParams({
    mode: "subscription",
    customer: String(reserved.customerId),
    client_reference_id: user.id,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": "1000",
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": "COSMIC ECHO Premium",
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][userId]": user.id,
    success_url: new URL("/?payment=success", process.env.APP_URL).toString(),
    cancel_url: new URL("/?payment=cancelled", process.env.APP_URL).toString(),
    expires_at: String(reserved.checkoutExpiresAt),
  });
  const checkout = await stripe(
    "checkout/sessions",
    params,
    `checkout-${user.id}-${reserved.checkoutKey}`,
  );
  currentAccount(user.id);
  if (
    typeof checkout.id !== "string" ||
    typeof checkout.url !== "string" ||
    !checkout.url.startsWith("https://checkout.stripe.com/")
  )
    throw new HttpError(502, "Liên kết thanh toán không hợp lệ.");
  sql
    .prepare(
      "UPDATE billing_accounts SET checkoutId=?,checkoutUrl=? WHERE userId=? AND checkoutKey=? AND deletionPending=0",
    )
    .run(checkout.id, checkout.url, user.id, String(reserved.checkoutKey));
  return { url: checkout.url };
}
export async function createPortal(userId: string) {
  const account = currentAccount(userId);
  const portal = await stripe(
    "billing_portal/sessions",
    new URLSearchParams({
      customer: String(account.customerId),
      return_url: new URL("/", process.env.APP_URL).toString(),
    }),
  );
  return { url: portal.url };
}

export function verifyStripeSignature(
  body: string,
  signature: string,
  now = Date.now(),
) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw new HttpError(503, "Webhook chưa được cấu hình.");
  const parts = signature.split(",").map((item) => item.split("="));
  const timestamp = parts.find((part) => part[0] === "t")?.[1] || "";
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw new HttpError(400, "Chữ ký không hợp lệ.");
  const expected = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest();
  const matches = parts
    .filter((part) => part[0] === "v1")
    .some((part) => {
      if (!/^[a-f0-9]{64}$/i.test(part[1] || "")) return false;
      const actual = Buffer.from(part[1], "hex");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    });
  if (!matches) throw new HttpError(400, "Chữ ký không hợp lệ.");
}
function paidThrough(subscription: Subscription): number {
  if (subscription.status !== "active") return 0;
  // Only the advertised paid monthly plan grants access. Trialing/other products
  // must never accidentally become a free Premium entitlement.
  const paidItems = (subscription.items?.data || []).filter(
    (item) =>
      item.price?.unit_amount === 1000 &&
      item.price.currency === "usd" &&
      item.price.recurring?.interval === "month" &&
      (item.price.recurring.interval_count ?? 1) === 1,
  );
  if (!paidItems.length) return 0;
  return Math.max(
    0,
    ...paidItems.map((item) =>
      Number(item.current_period_end || subscription.current_period_end || 0),
    ),
  );
}
let eventQueue = Promise.resolve();
export async function processStripeEvent(body: string, signature: string) {
  verifyStripeSignature(body, signature);
  const previous = eventQueue;
  let release!: () => void;
  eventQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await processVerifiedEvent(body);
  } finally {
    release();
  }
}

// The supported deployment is one web process per DATA_DIR. Serialize provider
// reads as well as SQLite writes so overlapping callbacks cannot apply an older
// provider snapshot after a newer callback has already committed.
async function processVerifiedEvent(body: string) {
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Sự kiện không hợp lệ.");
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string")
    throw new HttpError(400, "Sự kiện không hợp lệ.");
  const sql = billingDb();
  if (sql.prepare("SELECT id FROM billing_events WHERE id=?").get(event.id))
    return;
  let subscriptionId: string | undefined;
  const object = event.data?.object;
  if (event.type.startsWith("customer.subscription."))
    subscriptionId = object?.id;
  else if (event.type === "checkout.session.completed")
    subscriptionId = object?.subscription;
  else if (event.type.startsWith("invoice."))
    subscriptionId =
      object?.subscription ||
      object?.parent?.subscription_details?.subscription;
  if (typeof subscriptionId === "string") {
    const subscription: Subscription = await stripe(
      `subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    const customer =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    const account = sql
      .prepare(
        "SELECT userId FROM billing_accounts WHERE customerId=? AND deletionPending=0",
      )
      .get(customer);
    if (account) {
      // Reconcile all current subscriptions. An old cancellation must not revoke
      // a newer subscription, and event payload metadata cannot grant access.
      const subscriptions = await listCustomerSubscriptions(customer);
      const entitled = subscriptions
        .filter((item) => paidThrough(item) > Date.now() / 1000)
        .sort((a, b) => paidThrough(b) - paidThrough(a))[0];
      const ongoing = entitled || subscriptions.find(isOngoing);
      transaction(() => {
        if (
          sql.prepare("SELECT id FROM billing_events WHERE id=?").get(event.id)
        )
          return;
        if (
          sql
            .prepare(
              "SELECT userId FROM billing_accounts WHERE userId=? AND deletionPending=0",
            )
            .get(String(account.userId))
        ) {
          sql
            .prepare("UPDATE users SET premiumUntil=? WHERE id=?")
            .run(
              entitled
                ? new Date(paidThrough(entitled) * 1000).toISOString()
                : null,
              String(account.userId),
            );
          sql
            .prepare(
              "UPDATE billing_accounts SET subscriptionId=?,status=? WHERE userId=?",
            )
            .run(
              ongoing?.id || null,
              ongoing?.status || "canceled",
              String(account.userId),
            );
        }
        sql
          .prepare("INSERT OR IGNORE INTO billing_events VALUES(?,?)")
          .run(event.id, new Date().toISOString());
      });
      return;
    }
  }
  sql
    .prepare("INSERT OR IGNORE INTO billing_events VALUES(?,?)")
    .run(event.id, new Date().toISOString());
}

export async function cancelSubscriptionsForDeletion(userId: string) {
  const sql = billingDb();
  const account = sql
    .prepare("SELECT customerId FROM billing_accounts WHERE userId=?")
    .get(userId);
  if (!account) return;
  // Keep this guard on provider failure; retrying deletion can finish safely.
  sql
    .prepare("UPDATE billing_accounts SET deletionPending=1 WHERE userId=?")
    .run(userId);
  const customerId = String(account.customerId);
  const customer = await stripe(`customers/${encodeURIComponent(customerId)}`);
  if (customer.deleted) return;
  // Customer deletion permanently cancels subscriptions and prevents completing
  // outstanding checkouts for that customer. Explicit expiry also closes their URLs.
  let after = "";
  do {
    const page = await stripe(
      `checkout/sessions?customer=${encodeURIComponent(customerId)}&status=open&limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`,
    );
    if (!Array.isArray(page.data))
      throw new HttpError(502, "Chưa thể đóng các phiên thanh toán.");
    for (const session of page.data)
      await stripe(
        `checkout/sessions/${encodeURIComponent(session.id)}/expire`,
        new URLSearchParams(),
      );
    if (!page.has_more) break;
    const next = page.data.at(-1)?.id;
    if (typeof next !== "string" || next === after)
      throw new HttpError(502, "Chưa thể đóng các phiên thanh toán.");
    after = next;
  } while (true);
  await stripe(
    `customers/${encodeURIComponent(customerId)}`,
    undefined,
    undefined,
    "DELETE",
  );
}

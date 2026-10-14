import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { closeDb } from "../src/lib/db";
import {
  authDb,
  checkPassword,
  clearSession,
  currentUser,
  digest,
  findUser,
  hashPassword,
  newUser,
  SESSION_COOKIE,
  setSession,
} from "../src/lib/auth";
import { assertOrigin, HttpError, readJson } from "../src/lib/http";
import {
  cancelSubscriptionsForDeletion,
  createCheckout,
  processStripeEvent,
  verifyStripeSignature,
} from "../src/lib/billing";
import { POST as authPost } from "../src/app/api/auth/[action]/route";

let directory: string;
let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  closeDb();
  originalEnv = { ...process.env };
  directory = mkdtempSync(join(tmpdir(), "cosmic-auth-billing-"));
  process.env.DATA_DIR = directory;
  process.env.APP_URL = "https://cosmic.example.com";
  process.env.STRIPE_SECRET_KEY = "sk_test_not_a_secret";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_not_a_secret";
});
afterEach(() => {
  closeDb();
  process.env = originalEnv;
  rmSync(directory, { recursive: true, force: true });
});

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${body}`).digest("hex")}`;
}
function makeUser() {
  return findUser(newUser("Một vì sao", "person@example.com", null))!;
}
function subscription(id: string, status = "active", amount = 1000) {
  return {
    id,
    customer: "cus_test",
    status,
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          price: {
            currency: "usd",
            unit_amount: amount,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  };
}
function eventBody(id: string, subId = "sub_test") {
  return JSON.stringify({
    id,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: subId,
        status: "active",
        metadata: { userId: "cannot-grant-from-untrusted-metadata" },
      },
    },
  });
}
async function setupBilling(t: TestContext) {
  const user = makeUser();
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/customers")) return Response.json({ id: "cus_test" });
    if (path.includes("/subscriptions?"))
      return Response.json({ data: [], has_more: false });
    if (path.endsWith("/checkout/sessions"))
      return Response.json({
        id: "cs_test",
        url: "https://checkout.stripe.com/c/pay/cs_test",
      });
    throw new Error(`Unexpected mock URL ${path}`);
  });
  await createCheckout(user);
  t.mock.restoreAll();
  return user;
}

test("same-origin mutation guard rejects missing, foreign and lookalike origins", () => {
  const request = (origin?: string) =>
    new NextRequest("https://cosmic.example.com/api/action", {
      method: "POST",
      headers: origin ? { origin } : {},
    });
  assert.doesNotThrow(() =>
    assertOrigin(request("https://cosmic.example.com")),
  );
  for (const origin of [
    undefined,
    "https://evil.example.com",
    "https://cosmic.example.com.evil.com",
    "null",
  ]) {
    assert.throws(
      () => assertOrigin(request(origin)),
      (error) => error instanceof HttpError && error.status === 403,
    );
  }
});

test("JSON request limit applies even without Content-Length", async () => {
  const request = new NextRequest("https://cosmic.example.com/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "x".repeat(20001) }),
  });
  await assert.rejects(
    readJson(request),
    (error) => error instanceof HttpError && error.status === 413,
  );
});

test("password hashes use distinct salts and reject incorrect or missing credentials", async () => {
  const password = "A-long-password-123";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await checkPassword(password, first), true);
  assert.equal(await checkPassword("wrong-password", first), false);
  assert.equal(await checkPassword(password, null), false);
  assert.equal(await checkPassword(password, "broken"), false);
});

test("sessions store only hashes, expire on the server and are invalidated on logout", () => {
  const user = makeUser();
  const response = NextResponse.json({ ok: true });
  setSession(response, user.id);
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  const row = authDb()
    .prepare("SELECT tokenHash FROM sessions WHERE userId=?")
    .get(user.id);
  assert.equal(row?.tokenHash, digest(token));
  assert.notEqual(row?.tokenHash, token);
  assert.ok(response.headers.get("set-cookie")?.includes("HttpOnly"));
  assert.ok(response.headers.get("set-cookie")?.includes("SameSite=lax"));
  const request = new NextRequest("https://cosmic.example.com/api/state", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  assert.equal(currentUser(request)?.id, user.id);
  authDb()
    .prepare("UPDATE sessions SET expiresAt='2000-01-01T00:00:00.000Z'")
    .run();
  assert.equal(currentUser(request), null);
  setSession(response, user.id);
  const next = response.cookies.get(SESSION_COOKIE)!.value;
  const nextRequest = new NextRequest("https://cosmic.example.com/api/state", {
    headers: { cookie: `${SESSION_COOKIE}=${next}` },
  });
  clearSession(response, nextRequest);
  assert.equal(currentUser(nextRequest), null);
});

test("registration cannot self-assign Premium or staff and login verifies password", async () => {
  const post = (
    action: string,
    body: object,
    origin = "https://cosmic.example.com",
  ) =>
    authPost(
      new NextRequest(`https://cosmic.example.com/api/auth/${action}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ action }) },
    );
  const body = {
    name: "Người dùng",
    email: "person@example.com",
    password: "a-strong-password",
    role: "admin",
    premiumUntil: "2099-01-01T00:00:00.000Z",
  };
  assert.equal(
    (await post("register", body, "https://evil.example.com")).status,
    403,
  );
  assert.equal((await post("register", body)).status, 200);
  const user = authDb()
    .prepare("SELECT role,premiumUntil,passwordHash FROM users")
    .get();
  assert.equal(user?.role, "user");
  assert.equal(user?.premiumUntil, null);
  assert.notEqual(user?.passwordHash, body.password);
  assert.equal(
    (await post("login", { email: body.email, password: "wrong-password" }))
      .status,
    401,
  );
  const login = await post("login", body);
  assert.equal(login.status, 200);
  assert.ok(login.cookies.get(SESSION_COOKIE)?.value);
});

test("Stripe signature rejects changed body, stale timestamp and malformed signatures", () => {
  const body = eventBody("evt_test");
  assert.doesNotThrow(() => verifyStripeSignature(body, sign(body)));
  assert.throws(() => verifyStripeSignature(`${body} `, sign(body)), /Chữ ký/);
  assert.throws(
    () =>
      verifyStripeSignature(
        body,
        sign(body, Math.floor(Date.now() / 1000) - 301),
      ),
    /Chữ ký/,
  );
  assert.throws(
    () => verifyStripeSignature(body, `${sign(body)}junk`),
    /Chữ ký/,
  );
});

test("checkout reuses its durable session across time buckets and grants no free Premium", async (t) => {
  const user = makeUser();
  let checkoutCalls = 0;
  const timestamp = Date.now();
  const clock = t.mock.method(Date, "now", () => timestamp);
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/customers")) return Response.json({ id: "cus_test" });
      if (path.includes("/subscriptions?"))
        return Response.json({ data: [], has_more: false });
      if (path.endsWith("/checkout/sessions/cs_test"))
        return Response.json({ id: "cs_test", status: "open" });
      if (path.endsWith("/checkout/sessions")) {
        checkoutCalls++;
        const params = options.body as URLSearchParams;
        assert.equal(
          params.get("line_items[0][price_data][unit_amount]"),
          "1000",
        );
        assert.equal(params.get("line_items[0][price_data][currency]"), "usd");
        assert.equal(
          params.get("line_items[0][price_data][recurring][interval]"),
          "month",
        );
        return Response.json({
          id: "cs_test",
          url: "https://checkout.stripe.com/c/pay/cs_test",
        });
      }
      throw new Error("Unexpected request");
    },
  );
  const first = await createCheckout(user);
  clock.mock.mockImplementation(() => timestamp + 31 * 60_000);
  assert.deepEqual(await createCheckout(user), first);
  assert.equal(checkoutCalls, 1);
  assert.equal(findUser(user.id)?.premiumUntil, null);
});

test("an old cancellation webhook preserves newer paid Premium and duplicate events are idempotent", async (t) => {
  const user = await setupBilling(t);
  const newer = subscription("sub_new");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls++;
    if (String(url).includes("/subscriptions?"))
      return Response.json({
        data: [subscription("sub_old", "canceled"), newer],
        has_more: false,
      });
    return Response.json(subscription("sub_old", "canceled"));
  });
  const body = eventBody("evt_old_canceled", "sub_old");
  await processStripeEvent(body, sign(body));
  assert.equal(
    findUser(user.id)?.premiumUntil,
    new Date(newer.items.data[0].current_period_end * 1000).toISOString(),
  );
  assert.equal(
    authDb()
      .prepare("SELECT subscriptionId FROM billing_accounts WHERE userId=?")
      .get(user.id)?.subscriptionId,
    "sub_new",
  );
  await processStripeEvent(body, sign(body));
  assert.equal(calls, 2);
});

test("trial, wrong-priced subscription, tampered webhook and client metadata cannot grant Premium", async (t) => {
  const user = await setupBilling(t);
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).includes("/subscriptions?")
      ? Response.json({
          data: [
            subscription("sub_trial", "trialing"),
            subscription("sub_free", "active", 0),
          ],
          has_more: false,
        })
      : Response.json(subscription("sub_test")),
  );
  const body = eventBody("evt_no_payment");
  await assert.rejects(processStripeEvent(body, "invalid-signature"));
  await processStripeEvent(body, sign(body));
  assert.equal(findUser(user.id)?.premiumUntil, null);
});

test("account deletion expires open checkout and deletes Stripe customer before local deletion", async (t) => {
  const user = await setupBilling(t);
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options: RequestInit) => {
      const path = String(url);
      calls.push(`${options.method} ${path}`);
      if (path.includes("/checkout/sessions?"))
        return Response.json({ data: [{ id: "cs_test" }], has_more: false });
      return Response.json({
        id: "cus_test",
        deleted: options.method === "DELETE",
      });
    },
  );
  await cancelSubscriptionsForDeletion(user.id);
  assert.ok(
    calls.some((value) =>
      value.includes(
        "POST https://api.stripe.com/v1/checkout/sessions/cs_test/expire",
      ),
    ),
  );
  assert.ok(
    calls
      .at(-1)
      ?.includes("DELETE https://api.stripe.com/v1/customers/cus_test"),
  );
  await assert.rejects(
    createCheckout(user),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.ok(findUser(user.id));
});

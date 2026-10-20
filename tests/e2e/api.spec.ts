import { test, expect } from "@playwright/test";

const origin = { Origin: "http://127.0.0.1:3100" };
test("real HTTP flow: session, privacy, immutable letter, ownership and permanent deletion", async ({
  request,
  playwright,
}) => {
  const email = `flow-${Date.now()}@example.com`;
  const password = "test-password-12345";
  const registered = await request.post("/api/auth/register", {
    headers: origin,
    data: { name: "Người thử", email, password },
  });
  expect(registered.status()).toBe(200);
  expect(registered.headers()["set-cookie"]).toContain("HttpOnly");
  const user = (await (await request.get("/api/state")).json()).user;
  expect(user.role).toBe("user");
  expect(user.premiumUntil).toBeNull();
  const privatePost = await request.post("/api/action", {
    headers: origin,
    data: {
      action: "entry.create",
      payload: {
        content: "Tâm tư bí mật",
        mood: "sadness",
        visibility: "private",
        identity: "anonymous",
      },
    },
  });
  expect(privatePost.status()).toBe(200);
  const privateId = (await privatePost.json()).entries[0].id;
  const publicPost = await request.post("/api/action", {
    headers: origin,
    data: {
      action: "entry.create",
      payload: {
        content: "Một ngày nhiều nắng",
        mood: "joy",
        visibility: "public",
        identity: "anonymous",
      },
    },
  });
  expect(publicPost.status()).toBe(200);
  const guest = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  const publicState = await (await guest.get("/api/state")).json();
  expect(
    publicState.entries.some((e: { id: string }) => e.id === privateId),
  ).toBe(false);
  expect(JSON.stringify(publicState)).not.toContain(email);
  expect(JSON.stringify(publicState)).not.toContain(user.id);
  const letter = await request.post("/api/action", {
    headers: origin,
    data: {
      action: "letter.create",
      payload: {
        content: "Gửi tôi ngày mai",
        deliverAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
  });
  expect(letter.status()).toBe(200);
  const letterId = (await letter.json()).letters[0].id;
  expect(
    (
      await request.post("/api/action", {
        headers: origin,
        data: {
          action: "letter.update",
          payload: { id: letterId, content: "Không được sửa" },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/action", {
        headers: { Origin: "https://evil.example" },
        data: { action: "entry.delete", payload: { id: privateId } },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/action", {
        headers: origin,
        data: { action: "admin.role", payload: { email, role: "expert" } },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post("/api/billing/checkout", { headers: origin })).status(),
  ).toBe(503);
  expect(
    (
      await request.post("/api/action", {
        headers: origin,
        data: { action: "chat.send", payload: { content: "Xin chào" } },
      })
    ).status(),
  ).toBe(503);
  expect((await (await request.get("/api/state")).json()).chat.remaining).toBe(
    5,
  );
  const deleted = await request.post("/api/action", {
    headers: origin,
    data: {
      action: "account.delete",
      payload: { password, confirmation: "XOA VINH VIEN" },
    },
  });
  expect(deleted.status()).toBe(200);
  expect((await deleted.json()).user).toBeNull();
  expect(
    (await (await request.get("/api/state")).json()).entries.some(
      (e: { content: string }) => e.content === "Một ngày nhiều nắng",
    ),
  ).toBe(false);
  expect(
    (
      await request.post("/api/auth/login", {
        headers: origin,
        data: { email, password },
      })
    ).status(),
  ).toBe(401);
  await guest.dispose();
});

import { test, expect } from "@playwright/test";
import type { AppState } from "../../src/lib/types";

test("group owner confirms deletion; members keep their own journals privately", async ({
  page,
  browser,
}) => {
  const headers = { Origin: "http://127.0.0.1:3100" };
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    for (const [client, role] of [
      [page, "owner"],
      [member, "member"],
    ] as const) {
      const registered = await client.request.post("/api/auth/register", {
        headers,
        data: {
          name: role,
          email: `group-${role}-${Date.now()}@example.com`,
          password: "a-secure-passphrase-2026",
        },
      });
      expect(registered.ok()).toBe(true);
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "Vòng tròn kết nối", exact: true })
      .click();
    await page
      .getByLabel("Tên vòng tròn", { exact: true })
      .fill("Nhóm bình yên");
    await page
      .getByRole("button", { name: "Tạo vòng tròn", exact: true })
      .click();
    const card = page
      .locator(".group-grid .surface")
      .filter({ hasText: "Nhóm bình yên" });
    const deleteButton = card.getByRole("button", {
      name: "Xóa nhóm",
      exact: true,
    });
    await expect(deleteButton).toBeVisible();
    const ownerState: AppState = await (
      await page.request.get("/api/state")
    ).json();
    const group = ownerState.groups.find((g) => g.name === "Nhóm bình yên")!;
    expect(
      (
        await member.request.post("/api/action", {
          headers,
          data: { action: "group.join", payload: { id: group.id } },
        })
      ).ok(),
    ).toBe(true);
    const posts = [];
    for (const [client, content] of [
      [page, "Tâm tư của chủ nhóm"],
      [member, "Tâm tư của thành viên"],
    ] as const) {
      const created = await client.request.post("/api/action", {
        headers,
        data: {
          action: "entry.create",
          payload: {
            content,
            mood: "joy",
            visibility: "group",
            groupId: group.id,
          },
        },
      });
      expect(created.ok()).toBe(true);
      const state: AppState = await created.json();
      posts.push(state.entries.find((e) => e.content === content)!);
    }
    await member.goto("/");
    await member
      .getByRole("button", { name: "Vòng tròn kết nối", exact: true })
      .click();
    const memberCard = member
      .locator(".group-grid .surface")
      .filter({ hasText: group.name });
    await expect(
      memberCard.getByRole("button", { name: "Chia sẻ trong nhóm" }),
    ).toBeVisible();
    await expect(
      memberCard.getByRole("button", { name: "Xóa nhóm" }),
    ).toHaveCount(0);
    expect(
      (
        await member.request.post("/api/action", {
          headers,
          data: { action: "group.delete", payload: { id: group.id } },
        })
      ).status(),
    ).toBe(403);

    await page.reload();
    await page
      .getByRole("button", { name: "Vòng tròn kết nối", exact: true })
      .click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Nhóm bình yên");
      expect(dialog.message()).toContain("chuyển về riêng tư");
      await dialog.dismiss();
    });
    await deleteButton.click();
    await expect(card).toBeVisible();
    const cancelled: AppState = await (
      await page.request.get("/api/state")
    ).json();
    expect(cancelled.groups.some((g) => g.id === group.id)).toBe(true);
    expect(
      cancelled.entries.filter((e) => e.groupId === group.id),
    ).toHaveLength(2);

    page.once("dialog", (dialog) => dialog.accept());
    await deleteButton.click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Đã xóa nhóm");
    for (const [client, own, other] of [
      [page, posts[0], posts[1]],
      [member, posts[1], posts[0]],
    ] as const) {
      const state: AppState = await (
        await client.request.get("/api/state")
      ).json();
      expect(state.groups.some((g) => g.id === group.id)).toBe(false);
      expect(state.entries.find((e) => e.id === own.id)).toMatchObject({
        ...own,
        visibility: "private",
        groupId: null,
        supportVisible: false,
      });
      expect(state.entries.some((e) => e.id === other.id)).toBe(false);
    }
    await member.reload();
    await member
      .getByRole("button", { name: "Vòng tròn kết nối", exact: true })
      .click();
    await expect(memberCard).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});

test("desktop: guest journal, signup, persisted journal and immutable future letter", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Thiên hà của bạn", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Đang mở thiên hà…")).toBeHidden();
  await page.screenshot({
    path: "test-results/cosmic-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Gửi một tâm tư", exact: true })
    .click();
  await page
    .getByLabel("Điều bạn muốn gửi vào thiên hà")
    .fill("Một niềm vui trong phiên khách");
  await page
    .getByRole("button", { name: "Thả một vì sao vào thiên hà" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  expect((await page.request.get("/images/universe-starfield.svg")).ok()).toBe(
    true,
  );
  const privateSky = page.getByRole("region", { name: "Bầu trời riêng" });
  await privateSky
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("earth");
  await privateSky.getByRole("button", { name: /Mở Niềm vui/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Một niềm vui trong phiên khách",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.getByText("Một niềm vui trong phiên khách", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".profile-button").click();
  await page.getByLabel("Tên bạn muốn được gọi").fill("Minh An");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`ui-${Date.now()}@example.com`);
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("a-secure-passphrase-2026");
  await page.getByRole("button", { name: "Bắt đầu thiên hà của bạn" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { name: "Gửi một tâm tư", exact: true })
    .click();
  await page
    .getByLabel("Điều bạn muốn gửi vào thiên hà")
    .fill("Hôm nay mình đã bắt đầu một điều mới.");
  await page
    .getByRole("button", { name: "Thả một vì sao vào thiên hà" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await privateSky
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("earth");
  await privateSky.getByRole("button", { name: /Mở Niềm vui/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Hôm nay mình đã bắt đầu một điều mới.",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Thư gửi tương lai/ }).click();
  await page
    .getByRole("button", { name: "Viết một lá thư", exact: true })
    .click();
  await page
    .getByLabel("Nội dung lá thư")
    .fill("Mong bạn vẫn dành sự dịu dàng cho chính mình.");
  await page
    .getByLabel("Ngày và giờ nhận", { exact: false })
    .fill("2030-10-20T18:30");
  await expect(
    page.getByText(
      "Sau khi gửi, bạn không thể sửa nội dung hoặc thời điểm nhận.",
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xác nhận gửi vào tương lai" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".letter-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Một người lắng nghe", exact: true })
    .click();
  await expect(
    page.getByText("AI chưa được kết nối", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile: no horizontal overflow, navigation and compose dialog remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Đang mở thiên hà…")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/cosmic-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Thiên hà chung", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thiên hà chung", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Gửi một tâm tư", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("planet journals: white private system, isolated destinations, stars, motion and mobile", async ({
  page,
}) => {
  const headers = { Origin: "http://127.0.0.1:3100" };
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Người ngắm sao",
      email: `sky-${Date.now()}@example.com`,
      password: "a-secure-passphrase-2026",
    },
  });
  expect(registered.ok()).toBe(true);
  for (const [content, mood, visibility, planetId] of [
    ["Ánh sao công khai Trái Đất", "joy", "public", "earth"],
    ["Ánh sao công khai Sao Hỏa", "joy", "public", "mars"],
    ["Nỗi buồn riêng Trái Đất", "sadness", "private", "earth"],
    ["Lời gửi gió riêng Sao Hỏa", "unsaid", "private", "mars"],
  ]) {
    expect(
      (
        await page.request.post("/api/action", {
          headers,
          data: {
            action: "entry.create",
            payload: { content, mood, visibility, planetId },
          },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Đang mở thiên hà…")).toBeHidden();
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  expect((await page.request.get("/images/universe-starfield.svg")).ok()).toBe(
    true,
  );
  const privateSky = page.getByRole("region", { name: "Bầu trời riêng" });
  await expect(
    privateSky.getByRole("button", { name: /Dừng chân tại/ }),
  ).toHaveCount(8);
  await expect(privateSky.locator('[class*="whitePlanet"]')).toHaveCount(8);
  await expect(privateSky.locator("svg ellipse")).toHaveCount(8);
  expect(
    await privateSky
      .getByLabel("Bản đồ quỹ đạo, cuộn ngang để khám phá")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const planetLabels = privateSky.locator('[class*="planetLabel"]');
  await expect(planetLabels).toHaveCount(8);
  for (const label of await planetLabels.all())
    await expect(label).toBeHidden();
  await expect(privateSky.getByRole("img", { name: "Mặt Trời" })).toBeVisible();
  await expect(privateSky.getByRole("button", { name: /Mở / })).toHaveCount(0);
  await expect(page.locator(".entries-section")).toHaveCount(0);
  const privateBackground = privateSky.locator('[class*="distantStar"]');
  await expect(privateBackground).toHaveCount(210);
  await expect(privateBackground.first()).toHaveText("✦");
  await expect(privateBackground.first()).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await page.screenshot({
    style: "nextjs-portal { display: none !important; }",
    path: "test-results/universe-private.png",
    fullPage: true,
  });
  await privateSky
    .getByRole("button", { name: "Tạm dừng chuyển động" })
    .click();
  await expect(privateSky.locator('[class*="traveler"]').first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await expect(privateBackground.first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await privateSky
    .getByRole("button", { name: "Tiếp tục chuyển động" })
    .click();
  await expect(privateSky.locator('[class*="traveler"]').first()).toHaveCSS(
    "animation-play-state",
    "running",
  );
  await privateSky
    .getByRole("button", { name: "Tạm dừng chuyển động" })
    .click();
  await privateSky
    .getByRole("button", { name: "Dừng chân tại Trái Đất", exact: true })
    .click();
  await expect(privateSky.getByRole("button", { name: /Mở / })).toHaveCount(2);
  await privateSky
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("mars");
  await expect(privateSky.getByRole("button", { name: /Mở / })).toHaveCount(2);
  await privateSky.getByRole("button", { name: /Mở Lời gửi gió/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Lời gửi gió riêng Sao Hỏa",
  );
  await page.keyboard.press("Escape");
  await page.locator(".entries-section > summary").click();
  await expect(page.locator(".entry-grid")).toContainText(
    "Ánh sao công khai Sao Hỏa",
  );
  await expect(page.locator(".entry-grid")).not.toContainText(
    "Ánh sao công khai Trái Đất",
  );
  await privateSky.getByRole("button", { name: "← Về toàn cảnh" }).click();
  await expect(page.locator(".entries-section")).toHaveCount(0);
  await privateSky
    .getByRole("button", { name: "Tiếp tục chuyển động" })
    .click();

  await page
    .getByRole("button", { name: "Thiên hà chung", exact: true })
    .click();
  const system = page.getByRole("region", { name: "Hệ hành tinh chung" });
  await expect(system.getByRole("button", { name: /Mở / })).toHaveCount(0);
  await expect(system.locator('[class*="distantStar"]')).toHaveCount(210);
  await page.screenshot({
    style: "nextjs-portal { display: none !important; }",
    path: "test-results/universe-system.png",
    fullPage: true,
  });
  await system.getByRole("button", { name: "Tạm dừng chuyển động" }).click();
  const traveler = system.locator('[class*="traveler"]').first();
  await expect(traveler).toHaveCSS("animation-play-state", "paused");
  await system.getByRole("button", { name: "Tiếp tục chuyển động" }).click();
  await expect(traveler).toHaveCSS("animation-play-state", "running");
  await system.getByRole("button", { name: "Tạm dừng chuyển động" }).click();
  await system
    .getByRole("button", { name: "Dừng chân tại Trái Đất", exact: true })
    .click();
  await expect(system.getByRole("button", { name: /Mở Niềm vui/ })).toHaveCount(
    1,
  );
  await expect(
    system.getByRole("button", { name: /Mở Nỗi buồn|Mở Lời gửi gió/ }),
  ).toHaveCount(0);
  const journalStar = system
    .getByRole("button", { name: /Mở Niềm vui/ })
    .locator("span");
  await expect(journalStar).toHaveText("✦");
  await expect(journalStar).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.locator(".entries-section > summary").click();
  await expect(page.locator(".entry-grid")).toContainText(
    "Ánh sao công khai Trái Đất",
  );
  await expect(page.locator(".entry-grid")).not.toContainText(
    "Ánh sao công khai Sao Hỏa",
  );
  await page.screenshot({
    style: "nextjs-portal { display: none !important; }",
    path: "test-results/universe-earth.png",
    fullPage: true,
  });
  await system
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("mars");
  await system.getByRole("button", { name: /Mở Niềm vui/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Ánh sao công khai Sao Hỏa",
  );
  await page.keyboard.press("Escape");
  await system.getByRole("button", { name: "Tiếp tục chuyển động" }).click();
  await system.getByRole("button", { name: "Gửi một ánh sao" }).click();
  await expect(page.getByLabel("Gửi tâm tư đến hành tinh")).toHaveValue("mars");
  await page.getByLabel("Gửi tâm tư đến hành tinh").selectOption("venus");
  await page
    .getByLabel("Điều bạn muốn gửi vào thiên hà")
    .fill("Một ánh sao mới trên Sao Kim");
  await page
    .getByRole("button", { name: "Thả một vì sao vào thiên hà" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    system.getByRole("combobox", { name: "Chọn hành tinh" }),
  ).toHaveValue("venus");
  await expect(system.locator('[class*="launch"]')).toBeVisible();
  await expect(system.getByRole("button", { name: /Mở Niềm vui/ })).toHaveCount(
    1,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Thiên hà chung", exact: true })
    .click();
  await expect(system.getByRole("button", { name: /Mở / })).toHaveCount(0);
  await system
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("venus");
  await system.getByRole("button", { name: /Mở Niềm vui/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Một ánh sao mới trên Sao Kim",
  );
  await page.keyboard.press("Escape");
  await system.getByRole("button", { name: "← Về toàn cảnh" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(traveler).toHaveCSS("animation-name", "none");
  await expect(system.locator('[class*="distantStar"]').first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["", "earth", "venus", "mars"]) {
    await system
      .getByRole("combobox", { name: "Chọn hành tinh" })
      .selectOption(view);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    style: "nextjs-portal { display: none !important; }",
    path: "test-results/universe-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Thiên hà của bạn", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(privateSky.locator('[class*="whitePlanet"]')).toHaveCount(8);
  await expect(privateSky.locator('[class*="distantStar"]').first()).toHaveCSS(
    "animation-name",
    "none",
  );
  const map = privateSky.getByLabel("Bản đồ quỹ đạo, cuộn ngang để khám phá");
  expect(
    await map.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await map.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await privateSky
    .getByRole("button", { name: "Dừng chân tại Sao Hải Vương", exact: true })
    .click();
  await expect(
    privateSky.getByRole("combobox", { name: "Chọn hành tinh" }),
  ).toHaveValue("neptune");
  await privateSky.getByRole("button", { name: "← Về toàn cảnh" }).click();
  await page.screenshot({
    style: "nextjs-portal { display: none !important; }",
    path: "test-results/universe-private-mobile.png",
    fullPage: true,
  });
});

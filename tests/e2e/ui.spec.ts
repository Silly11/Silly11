import { test, expect } from "@playwright/test";

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
  const privateSky = page.getByRole("region", { name: "Bầu trời riêng" });
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

test("planet system: public stars, viewpoints, pause, mobile and reduced motion", async ({
  page,
}) => {
  const registered = await page.request.post("/api/auth/register", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      name: "Người ngắm sao",
      email: `sky-${Date.now()}@example.com`,
      password: "a-secure-passphrase-2026",
    },
  });
  expect(registered.ok()).toBe(true);
  for (const [mood, visibility] of [
    ["joy", "public"],
    ["sadness", "private"],
    ["unsaid", "private"],
  ]) {
    const created = await page.request.post("/api/action", {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: {
        action: "entry.create",
        payload: {
          content: `Bầu trời ${mood}`,
          mood,
          visibility,
          identity: "anonymous",
        },
      },
    });
    expect(created.ok()).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Đang mở thiên hà…")).toBeHidden();
  const privateSky = page.getByRole("region", { name: "Bầu trời riêng" });
  await expect(privateSky.getByRole("button", { name: /Mở / })).toHaveCount(3);
  await expect(privateSky).not.toContainText("Bầu trời sadness");
  await privateSky.getByRole("button", { name: /Mở Lời gửi gió/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Bầu trời unsaid");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "test-results/universe-private.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Thiên hà chung", exact: true })
    .click();
  const system = page.getByRole("region", { name: "Hệ hành tinh chung" });
  await expect(
    system.getByRole("button", { name: /Dừng chân tại/ }),
  ).toHaveCount(8);
  await expect(
    system.getByRole("button", { name: /Mở Nỗi buồn|Mở Lời gửi gió/ }),
  ).toHaveCount(0);
  await page.screenshot({
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
  await expect(
    system.getByText("Một khoảng bình yên trên Trái Đất"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/universe-earth.png",
    fullPage: true,
  });
  await system
    .getByRole("combobox", { name: "Chọn hành tinh" })
    .selectOption("mars");
  await expect(
    system.getByText("Một khoảng bình yên trên Sao Hỏa"),
  ).toBeVisible();
  await system.getByRole("button", { name: "Tiếp tục chuyển động" }).click();
  await system.getByRole("button", { name: "Gửi một ánh sao" }).click();
  await page
    .getByLabel("Điều bạn muốn gửi vào thiên hà")
    .fill("Một ánh sao mới bay lên");
  await page
    .getByRole("button", { name: "Thả một vì sao vào thiên hà" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(system.locator('[class*="launch"]')).toBeVisible();
  await expect(system.getByRole("button", { name: /Mở Niềm vui/ })).toHaveCount(
    2,
  );
  await system.getByRole("button", { name: "← Về toàn cảnh" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(traveler).toHaveCSS("animation-name", "none");
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
  await page
    .getByRole("button", { name: "Đóng thông báo", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/universe-mobile.png",
    fullPage: true,
  });
});

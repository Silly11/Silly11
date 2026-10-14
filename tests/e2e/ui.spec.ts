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
  await expect(
    page.getByText("Một niềm vui trong phiên khách", { exact: true }).first(),
  ).toBeVisible();
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
  await expect(
    page
      .getByText("Hôm nay mình đã bắt đầu một điều mới.", { exact: true })
      .first(),
  ).toBeVisible();
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

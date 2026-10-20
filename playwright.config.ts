import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_URL: "http://127.0.0.1:3100",
      DATA_DIR: mkdtempSync(join(tmpdir(), "cosmic-e2e-")),
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      RESEND_API_KEY: "",
    },
  },
});

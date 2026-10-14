import { runMaintenance } from "../src/lib/maintenance";
import { closeDb } from "../src/lib/db";

const once = process.argv.includes("--once");
let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

async function main() {
  do {
    try {
      const result = await runMaintenance();
      console.log(JSON.stringify({ task: "maintenance", ...result }));
    } catch {
      // Do not put journal text, account addresses, or provider secrets in logs.
      console.error(
        "Maintenance failed; check storage permissions and service configuration.",
      );
      if (once) process.exitCode = 1;
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = undefined;
  } while (!stopping);
}

main().finally(closeDb);

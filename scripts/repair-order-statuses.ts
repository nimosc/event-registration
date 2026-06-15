import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || !process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

async function main() {
  const { repairMisopenedOrderStatuses } = await import("../src/lib/monday");
  const result = await repairMisopenedOrderStatuses();
  console.log(
    JSON.stringify(
      {
        repairedCount: result.repaired.length,
        skipped: result.skipped,
        repaired: result.repaired,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

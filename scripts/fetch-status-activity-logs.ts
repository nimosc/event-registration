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

const STATUS_COLUMN_ID = "color_mm18ej76";
const STATUS_OPEN = "בתהליך שיבוץ";

async function main() {
  const { mondayQuery, BOARDS, getAllOrders, getColumnValue } = await import(
    "../src/lib/monday"
  );

  const from = "2026-06-14T00:00:00Z";
  const to = "2026-06-16T23:59:59Z";

  const allLogs: Array<{
    id: string;
    event: string;
    entity: string;
    data: string;
    created_at: string;
  }> = [];

  for (let page = 1; page <= 40; page++) {
    const query = `
      query {
        boards(ids: [${BOARDS.ORDERS}]) {
          activity_logs(
            page: ${page}
            limit: 100
            from: "${from}"
            to: "${to}"
            column_ids: ["${STATUS_COLUMN_ID}"]
          ) {
            id
            event
            entity
            data
            created_at
          }
        }
      }
    `;
    const data = await mondayQuery<{
      boards: Array<{
        activity_logs: Array<{
          id: string;
          event: string;
          entity: string;
          data: string;
          created_at: string;
        }>;
      }>;
    }>(query);
    const logs = data.boards[0]?.activity_logs ?? [];
    if (logs.length === 0) break;
    allLogs.push(...logs);
    if (logs.length < 100) break;
  }

  console.log(`Fetched ${allLogs.length} status activity logs`);

  const sample = allLogs.slice(0, 5);
  for (const log of sample) {
    console.log("\n--- sample log ---");
    console.log(log.event, log.entity, log.created_at);
    console.log(log.data.slice(0, 400));
  }

  const items = await getAllOrders();
  const openNow = items.filter(
    (item) => getColumnValue(item, STATUS_COLUMN_ID)?.text === STATUS_OPEN
  );
  console.log(`\nCurrently בתהליך שיבוץ: ${openNow.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

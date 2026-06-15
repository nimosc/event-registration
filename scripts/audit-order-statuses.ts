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
  const { mondayQuery, BOARDS, getAllOrders, getColumnValue } = await import(
    "../src/lib/monday"
  );

  const boardQuery = `
    query {
      boards(ids: [${BOARDS.ORDERS}]) {
        columns(ids: ["color_mm18ej76"]) {
          id
          title
          settings_str
        }
      }
    }
  `;
  const boardData = await mondayQuery<{
    boards: Array<{ columns: Array<{ id: string; title: string; settings_str: string }> }>;
  }>(boardQuery);

  const settings = boardData.boards[0]?.columns[0]?.settings_str;
  console.log("=== STATUS COLUMN LABELS ===");
  if (settings) {
    try {
      const parsed = JSON.parse(settings) as {
        labels?: Record<string, string>;
        labels_colors?: Record<string, string>;
      };
      const labels = parsed.labels ?? {};
      console.log(Object.values(labels).sort().join("\n"));
    } catch {
      console.log(settings.slice(0, 500));
    }
  }

  const items = await getAllOrders();
  const byStatus = new Map<string, Array<{ id: string; name: string; date: string }>>();

  for (const item of items) {
    const status = getColumnValue(item, "color_mm18ej76")?.text || "(empty)";
    const date = getColumnValue(item, "date_mm18mqn2")?.text || "";
    const list = byStatus.get(status) ?? [];
    list.push({ id: item.id, name: item.name, date });
    byStatus.set(status, list);
  }

  console.log("\n=== CURRENT STATUS COUNTS ===");
  for (const [status, list] of [...byStatus.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${list.length}\t${status}`);
  }

  console.log("\n=== בתהליך שיבוץ ORDERS ===");
  for (const o of byStatus.get("בתהליך שיבוץ") ?? []) {
    console.log(`${o.id}\t${o.date}\t${o.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

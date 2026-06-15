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
const BUG_START_MS = new Date("2026-06-14T00:00:00Z").getTime();

type ActivityLog = {
  id: string;
  event: string;
  entity: string;
  data: string;
  created_at: string;
};

function parseLogData(data: string): {
  pulse_id?: number;
  pulse_name?: string;
  valueText?: string;
  previousText?: string;
} {
  try {
    const parsed = JSON.parse(data) as {
      pulse_id?: number;
      pulse_name?: string;
      value?: { label?: { text?: string } };
      previous_value?: { label?: { text?: string } };
    };
    return {
      pulse_id: parsed.pulse_id,
      pulse_name: parsed.pulse_name,
      valueText: parsed.value?.label?.text,
      previousText: parsed.previous_value?.label?.text,
    };
  } catch {
    return {};
  }
}

function logTimeMs(createdAt: string): number {
  const n = Number(createdAt);
  if (Number.isFinite(n) && n > 1e15) return Math.floor(n / 10000);
  const d = Date.parse(createdAt);
  return Number.isFinite(d) ? d : 0;
}

async function fetchStatusActivityLogs(
  mondayQuery: typeof import("../src/lib/monday").mondayQuery,
  boardId: number
): Promise<ActivityLog[]> {
  const all: ActivityLog[] = [];
  for (let page = 1; page <= 100; page++) {
    const query = `
      query {
        boards(ids: [${boardId}]) {
          activity_logs(
            page: ${page}
            limit: 100
            from: "2026-01-01T00:00:00Z"
            to: "2026-06-16T23:59:59Z"
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
      boards: Array<{ activity_logs: ActivityLog[] }>;
    }>(query);
    const logs = data.boards[0]?.activity_logs ?? [];
    if (logs.length === 0) break;
    all.push(...logs);
    if (logs.length < 100) break;
  }
  return all;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { mondayQuery, BOARDS, getAllOrders, getColumnValue, updateOrderStatus } =
    await import("../src/lib/monday");

  const logs = await fetchStatusActivityLogs(mondayQuery, BOARDS.ORDERS);
  console.log(`Fetched ${logs.length} status logs`);

  const restoreByPulse = new Map<string, { to: string; from: string; name: string }>();

  const byPulse = new Map<string, ActivityLog[]>();
  for (const log of logs) {
    if (log.event !== "update_column_value") continue;
    const { pulse_id, valueText, previousText } = parseLogData(log.data);
    if (!pulse_id || !valueText || !previousText) continue;
    const key = String(pulse_id);
    const list = byPulse.get(key) ?? [];
    list.push(log);
    byPulse.set(key, list);
  }

  for (const [pulseId, pulseLogs] of byPulse) {
    const sorted = [...pulseLogs].sort((a, b) => logTimeMs(a.created_at) - logTimeMs(b.created_at));
    const wrongful = sorted.find((log) => {
      const { valueText, previousText } = parseLogData(log.data);
      return (
        valueText === STATUS_OPEN &&
        !!previousText &&
        previousText !== STATUS_OPEN &&
        logTimeMs(log.created_at) >= BUG_START_MS
      );
    });
    if (!wrongful) continue;
    const { previousText, pulse_name } = parseLogData(wrongful.data);
    if (!previousText) continue;
    restoreByPulse.set(pulseId, {
      to: previousText,
      from: STATUS_OPEN,
      name: pulse_name || pulseId,
    });
  }

  const items = await getAllOrders();
  const toRestore: Array<{
    id: string;
    name: string;
    current: string;
    target: string;
  }> = [];

  for (const item of items) {
    const current = getColumnValue(item, STATUS_COLUMN_ID)?.text || "";
    const plan = restoreByPulse.get(item.id);
    if (!plan) continue;
    if (current === plan.to) continue;
    // Restore if currently wrongfully open OR wrongly repaired to הסתיים השיבוץ
    if (current === STATUS_OPEN || current === "הסתיים השיבוץ") {
      toRestore.push({
        id: item.id,
        name: item.name,
        current,
        target: plan.to,
      });
    }
  }

  const byTarget = new Map<string, number>();
  for (const row of toRestore) {
    byTarget.set(row.target, (byTarget.get(row.target) ?? 0) + 1);
  }

  console.log(`\nRestore plan: ${toRestore.length} orders`);
  for (const [status, count] of [...byTarget.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${status}`);
  }

  const openAfter = items.filter(
    (i) => getColumnValue(i, STATUS_COLUMN_ID)?.text === STATUS_OPEN
  ).length;
  const wouldStayOpen = openAfter - toRestore.filter((r) => r.current === STATUS_OPEN).length;
  console.log(`\nWould leave ${wouldStayOpen} in בתהליך שיבוץ`);

  if (!apply) {
    console.log("\nDry run. Pass --apply to write changes.");
    console.log(toRestore.slice(0, 20).map((r) => `${r.id}\t${r.current} -> ${r.target}\t${r.name}`).join("\n"));
    return;
  }

  for (const row of toRestore) {
    await updateOrderStatus(row.id, row.target);
    console.log(`restored ${row.id}: ${row.current} -> ${row.target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

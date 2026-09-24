import { readFileSync } from "node:fs";
import { resolve } from "node:path";
function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv();
/**
 * Monday לא מאפשר להוסיף תווית סטטוס ישירות; כתיבת ערך עם create_labels_if_missing
 * יוצרת אותה. usage: add-role-label.ts <artistItemId> <label>
 */
async function main() {
  const [itemId, label] = process.argv.slice(2);
  if (!itemId || !label) throw new Error("usage: add-role-label.ts <artistItemId> <label>");
  const m = await import("../src/lib/monday");
  await m.mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $vals: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $vals, create_labels_if_missing: true) { id }
    }`,
    { boardId: String(m.BOARDS.ARTISTS), itemId, vals: JSON.stringify({ color_mm18btbr: { label } }) }
  );
  const cols = await m.mondayQuery<{ boards: { columns: { id: string; settings_str: string }[] }[] }>(
    `query { boards(ids: [${m.BOARDS.ARTISTS}]) { columns { id settings_str } } }`);
  console.log("labels now:", JSON.parse(cols.boards[0].columns.find((c) => c.id === "color_mm18btbr")!.settings_str).labels);
  console.log("readback for item:", await m.getLiveArtistRole(itemId));
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });

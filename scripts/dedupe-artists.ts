/**
 * One-time cleanup: deduplicate artist records on the ARTISTS board.
 *
 * Artists repeatedly "re-registered", creating duplicate records sharing the same
 * phone number (85 groups / ~210 records at time of writing). Per policy:
 *   - Exactly one active (פעיל) record in a group → it is canonical.
 *   - Multiple active records → the one with the most linked data (subitems +
 *     invoices) is canonical; tie broken by oldest created_at.
 *   - No active record → the NEWEST record is kept (latest pending attempt).
 *
 * For every non-canonical record: relink its subitems (board_relation_mm18r4da on
 * SUBITEMS) and invoices (board_relation_mm3pxdzs on INVOICES) to the canonical
 * record, then delete it (delete_item → Monday recycle bin, recoverable 30 days).
 * A record whose relink fails is NOT deleted.
 *
 * Same-name groups with DIFFERENT phones are only reported (manual review).
 *
 * Dry run by default. Pass --apply to perform the changes.
 *   npx tsx scripts/dedupe-artists.ts          # dry run
 *   npx tsx scripts/dedupe-artists.ts --apply  # execute
 */
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

const ARTIST_PHONE_COLUMN_ID = "phone_mm18x459";
const ARTIST_STATUS_COLUMN_ID = "color_mm18wjry";
const SUBITEM_ARTIST_RELATION_COLUMN_ID = "board_relation_mm18r4da";

interface ArtistRecord {
  id: string;
  name: string;
  created: string;
  phone: string;
  status: string;
}

interface LinkRef {
  itemId: string; // subitem or invoice id
  linkedIds: number[];
}

function normalizePhone(raw: string): string {
  let p = (raw || "").replace(/[^\d]/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("972")) p = "0" + p.slice(3);
  return p;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { mondayQuery, BOARDS, INVOICE_ARTIST_RELATION_COLUMN_ID } =
    await import("../src/lib/monday");

  // ── 1. Fetch all artists ────────────────────────────────────────────────
  type ArtistPageItem = {
    id: string;
    name: string;
    created_at: string;
    column_values: Array<{ id: string; text: string | null }>;
  };
  type ArtistPage = { cursor: string | null; items: ArtistPageItem[] };

  const artists: ArtistRecord[] = [];
  {
    let cursor: string | null = null;
    let first = true;
    while (first || cursor) {
      const query: string = first
        ? `{ boards(ids: [${BOARDS.ARTISTS}]) { items_page(limit: 500) { cursor items { id name created_at column_values(ids: ["${ARTIST_PHONE_COLUMN_ID}", "${ARTIST_STATUS_COLUMN_ID}"]) { id text } } } } }`
        : `{ next_items_page(cursor: "${cursor}", limit: 500) { cursor items { id name created_at column_values(ids: ["${ARTIST_PHONE_COLUMN_ID}", "${ARTIST_STATUS_COLUMN_ID}"]) { id text } } } }`;
      const data = await mondayQuery<{
        boards?: Array<{ items_page: ArtistPage }>;
        next_items_page?: ArtistPage;
      }>(query);
      const page: ArtistPage | undefined = first ? data.boards?.[0]?.items_page : data.next_items_page;
      first = false;
      for (const it of page?.items ?? []) {
        const byId = (id: string) => (it.column_values.find((c) => c.id === id)?.text || "").trim();
        artists.push({
          id: it.id,
          name: it.name.trim(),
          created: it.created_at,
          phone: normalizePhone(byId(ARTIST_PHONE_COLUMN_ID)),
          status: byId(ARTIST_STATUS_COLUMN_ID),
        });
      }
      cursor = page?.cursor ?? null;
    }
  }
  console.log(`Fetched ${artists.length} artists.`);

  // ── 2. Scan links: subitems (orders board) and invoices ────────────────
  type OrderPageItem = {
    subitems: Array<{ id: string; column_values: Array<{ id: string; linked_item_ids?: string[] | null }> }> | null;
  };
  type OrderPage = { cursor: string | null; items: OrderPageItem[] };

  const subitemLinksByArtist = new Map<string, LinkRef[]>();
  {
    let cursor: string | null = null;
    let first = true;
    while (first || cursor) {
      const cols = `column_values(ids: ["${SUBITEM_ARTIST_RELATION_COLUMN_ID}"]) { id ... on BoardRelationValue { linked_item_ids } }`;
      const query: string = first
        ? `{ boards(ids: [${BOARDS.ORDERS}]) { items_page(limit: 100) { cursor items { subitems { id ${cols} } } } } }`
        : `{ next_items_page(cursor: "${cursor}", limit: 100) { cursor items { subitems { id ${cols} } } } }`;
      const data = await mondayQuery<{
        boards?: Array<{ items_page: OrderPage }>;
        next_items_page?: OrderPage;
      }>(query);
      const page: OrderPage | undefined = first ? data.boards?.[0]?.items_page : data.next_items_page;
      first = false;
      for (const it of page?.items ?? []) {
        for (const sub of it.subitems ?? []) {
          const relCol = sub.column_values.find((c) => c.id === SUBITEM_ARTIST_RELATION_COLUMN_ID);
          const linkedIds = (relCol?.linked_item_ids ?? []).map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n));
          for (const artistId of linkedIds) {
            const key = String(artistId);
            if (!subitemLinksByArtist.has(key)) subitemLinksByArtist.set(key, []);
            subitemLinksByArtist.get(key)!.push({ itemId: sub.id, linkedIds });
          }
        }
      }
      cursor = page?.cursor ?? null;
    }
  }
  console.log(`Scanned subitem links (artists with links: ${subitemLinksByArtist.size}).`);

  const invoiceLinksByArtist = new Map<string, LinkRef[]>();
  {
    const query = `{ boards(ids: [${BOARDS.INVOICES}]) { items_page(limit: 500) { items { id column_values(ids: ["${INVOICE_ARTIST_RELATION_COLUMN_ID}"]) { id ... on BoardRelationValue { linked_item_ids } } } } } }`;
    const data = await mondayQuery<{
      boards: Array<{ items_page: { items: Array<{ id: string; column_values: Array<{ id: string; linked_item_ids?: string[] | null }> }> } }>;
    }>(query);
    for (const it of data.boards[0]?.items_page?.items ?? []) {
      const relCol = it.column_values.find((c) => c.id === INVOICE_ARTIST_RELATION_COLUMN_ID);
      const linkedIds = (relCol?.linked_item_ids ?? []).map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n));
      for (const artistId of linkedIds) {
        const key = String(artistId);
        if (!invoiceLinksByArtist.has(key)) invoiceLinksByArtist.set(key, []);
        invoiceLinksByArtist.get(key)!.push({ itemId: it.id, linkedIds });
      }
    }
  }
  console.log(`Scanned invoice links (artists with links: ${invoiceLinksByArtist.size}).`);

  const linkCount = (artistId: string) =>
    (subitemLinksByArtist.get(artistId)?.length ?? 0) + (invoiceLinksByArtist.get(artistId)?.length ?? 0);

  // ── 3. Group by phone and pick canonical ───────────────────────────────
  const byPhone = new Map<string, ArtistRecord[]>();
  for (const a of artists) {
    if (!a.phone) continue;
    if (!byPhone.has(a.phone)) byPhone.set(a.phone, []);
    byPhone.get(a.phone)!.push(a);
  }

  interface GroupPlan {
    phone: string;
    canonical: ArtistRecord;
    reason: string;
    toDelete: ArtistRecord[];
  }
  const plans: GroupPlan[] = [];

  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    const actives = group.filter((a) => a.status === "פעיל");
    let canonical: ArtistRecord;
    let reason: string;
    if (actives.length === 1) {
      canonical = actives[0];
      reason = "הפעילה היחידה";
    } else if (actives.length > 1) {
      const sorted = [...actives].sort((a, b) => {
        const diff = linkCount(b.id) - linkCount(a.id);
        if (diff !== 0) return diff;
        return a.created.localeCompare(b.created);
      });
      canonical = sorted[0];
      reason = `מרובות-פעילות: הכי מקושרת (${linkCount(canonical.id)} קישורים), הוותיקה בשוויון`;
    } else {
      const sorted = [...group].sort((a, b) => b.created.localeCompare(a.created));
      canonical = sorted[0];
      reason = "אין פעילה — נשמר הניסיון האחרון";
    }
    const toDelete = group.filter((a) => a.id !== canonical.id);
    plans.push({ phone, canonical, reason, toDelete });
  }

  // Same-name different-phone groups — report only.
  const byName = new Map<string, ArtistRecord[]>();
  for (const a of artists) {
    if (!byName.has(a.name)) byName.set(a.name, []);
    byName.get(a.name)!.push(a);
  }
  const nameOnlyGroups = [...byName.entries()].filter(([, g]) => {
    if (g.length < 2) return false;
    const phones = new Set(g.map((a) => a.phone));
    return phones.size > 1;
  });

  // ── 4. Report ──────────────────────────────────────────────────────────
  const totalDeletes = plans.reduce((n, p) => n + p.toDelete.length, 0);
  let totalSubitemRelinks = 0;
  let totalInvoiceRelinks = 0;
  console.log(`\nDuplicate phone groups: ${plans.length}; records to delete: ${totalDeletes}\n`);
  for (const p of plans.sort((a, b) => b.toDelete.length - a.toDelete.length)) {
    console.log(`PHONE ${p.phone} — canonical #${p.canonical.id} "${p.canonical.name}" [${p.canonical.status || "ריק"}] (${p.reason})`);
    for (const d of p.toDelete) {
      const subs = subitemLinksByArtist.get(d.id) ?? [];
      const invs = invoiceLinksByArtist.get(d.id) ?? [];
      totalSubitemRelinks += subs.length;
      totalInvoiceRelinks += invs.length;
      const links = [
        subs.length ? `${subs.length} subitems→relink` : "",
        invs.length ? `${invs.length} invoices→relink` : "",
      ].filter(Boolean).join(", ") || "no links";
      console.log(`    DELETE #${d.id} [${d.status || "ריק"}] ${d.created.slice(0, 10)} — ${links}`);
    }
  }
  console.log(`\nPlanned relinks: ${totalSubitemRelinks} subitems, ${totalInvoiceRelinks} invoices.`);
  console.log(`\nSame-name different-phone groups (MANUAL REVIEW, untouched): ${nameOnlyGroups.length}`);
  for (const [name, g] of nameOnlyGroups) {
    console.log(`  '${name}': ${g.map((a) => `#${a.id}[${a.status || "ריק"}/${a.phone || "אין-טלפון"}]`).join(" , ")}`);
  }

  if (!apply) {
    console.log("\nDry run. Pass --apply to relink and delete.");
    return;
  }

  // ── 5. Apply: relink then delete, per record ───────────────────────────
  const relinkColumn = async (
    boardId: number,
    itemId: string,
    columnId: string,
    oldLinked: number[],
    fromId: string,
    toId: string
  ) => {
    const newIds = [...new Set(oldLinked.map((id) => (String(id) === fromId ? parseInt(toId, 10) : id)))];
    await mondayQuery(
      `mutation {
        change_column_value(
          board_id: ${boardId},
          item_id: ${itemId},
          column_id: "${columnId}",
          value: ${JSON.stringify(JSON.stringify({ item_ids: newIds }))}
        ) { id }
      }`
    );
  };

  let deleted = 0;
  let relinked = 0;
  let failed = 0;
  for (const p of plans) {
    for (const d of p.toDelete) {
      try {
        for (const ref of subitemLinksByArtist.get(d.id) ?? []) {
          await relinkColumn(BOARDS.SUBITEMS, ref.itemId, SUBITEM_ARTIST_RELATION_COLUMN_ID, ref.linkedIds, d.id, p.canonical.id);
          relinked++;
        }
        for (const ref of invoiceLinksByArtist.get(d.id) ?? []) {
          await relinkColumn(BOARDS.INVOICES, ref.itemId, INVOICE_ARTIST_RELATION_COLUMN_ID, ref.linkedIds, d.id, p.canonical.id);
          relinked++;
        }
        await mondayQuery(`mutation { delete_item(item_id: ${d.id}) { id } }`);
        deleted++;
        console.log(`deleted #${d.id} "${d.name}" → canonical #${p.canonical.id}`);
      } catch (err) {
        failed++;
        console.error(`FAILED (record NOT deleted) #${d.id} "${d.name}":`, err);
      }
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, relinked: ${relinked}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

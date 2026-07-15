/**
 * One-time fix: recompute the "סטטוס התאמה" column (color_mm50n91j) for ALL invoice items.
 *
 * Background: ~19 items were bulk-set manually in Monday (before the feature deployed)
 * with INVERTED values, and ~33 older items were never backfilled. The app code itself
 * writes correct values for new submissions — this script only repairs historical data.
 *
 * Logic per item (mirrors the approved spec):
 *   1. Voluntary submission (סוג הגשה = בקשה לבדיקה) → base תקין.
 *   2. Else base = amountsMatch(reported, expected) ? תקין : בקשת תשלום שונה.
 *      reported missing → compare extracted vs expected; both missing → תקין.
 *   3. If submission status = הוגש מסמך חשבונאי and extracted mismatches (reported ?? expected)
 *      → override to קבלה שונה מהבקשת תשלום (extracted holds the receipt amount at that stage).
 *   4. Write only when computed differs from the current column value.
 *
 * Dry run by default. Pass --apply to perform the changes.
 *   npx tsx scripts/fix-invoice-match-status.ts          # dry run
 *   npx tsx scripts/fix-invoice-match-status.ts --apply  # execute
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

type ColumnValue = { id: string; text: string | null };
type InvoiceItem = { id: string; name: string; column_values: ColumnValue[] };

function parseAmount(text: string | null | undefined): number | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const {
    mondayQuery,
    BOARDS,
    updateInvoiceMatchStatus,
    INVOICE_MATCH_STATUS_COLUMN_ID,
    INVOICE_SUBMISSION_STATUS_COLUMN_ID,
    INVOICE_SUBMISSION_TYPE_COLUMN_ID,
    INVOICE_AMOUNT_EXPECTED_COLUMN_ID,
    INVOICE_AMOUNT_REPORTED_COLUMN_ID,
    INVOICE_AMOUNT_EXTRACTED_COLUMN_ID,
  } = await import("../src/lib/monday");
  const { INVOICE_MATCH_STATUS, INVOICE_SUBMISSION_STATUS, INVOICE_SUBMISSION_TYPE } =
    await import("../src/lib/invoiceDocuments");
  const { invoiceAmountsMatch } = await import("../src/lib/invoiceValidation");

  const query = `
    query {
      boards(ids: [${BOARDS.INVOICES}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: [
              "${INVOICE_MATCH_STATUS_COLUMN_ID}",
              "${INVOICE_SUBMISSION_STATUS_COLUMN_ID}",
              "${INVOICE_SUBMISSION_TYPE_COLUMN_ID}",
              "${INVOICE_AMOUNT_EXPECTED_COLUMN_ID}",
              "${INVOICE_AMOUNT_REPORTED_COLUMN_ID}",
              "${INVOICE_AMOUNT_EXTRACTED_COLUMN_ID}"
            ]) {
              id
              text
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{
    boards: Array<{ items_page: { items: InvoiceItem[] } }>;
  }>(query);
  const items = data.boards[0]?.items_page?.items ?? [];

  const changes: Array<{ id: string; name: string; current: string; computed: string }> = [];
  let keep = 0;

  for (const item of items) {
    const byId = (id: string) => (item.column_values.find((c) => c.id === id)?.text || "").trim();
    const current = byId(INVOICE_MATCH_STATUS_COLUMN_ID);
    const submissionStatus = byId(INVOICE_SUBMISSION_STATUS_COLUMN_ID);
    const submissionType = byId(INVOICE_SUBMISSION_TYPE_COLUMN_ID);
    const expected = parseAmount(byId(INVOICE_AMOUNT_EXPECTED_COLUMN_ID));
    const reported = parseAmount(byId(INVOICE_AMOUNT_REPORTED_COLUMN_ID));
    const extracted = parseAmount(byId(INVOICE_AMOUNT_EXTRACTED_COLUMN_ID));

    // 1-2. Base status: request vs system-calculated amount.
    // Manual submissions (בקשה לבדיקה) have no system-calculated amount →
    // always flagged בקשת תשלום שונה (policy update 2026-07-15).
    let computed: string;
    if (submissionType === INVOICE_SUBMISSION_TYPE.REVIEW) {
      computed = INVOICE_MATCH_STATUS.REQUEST_DIFFERENT;
    } else if (reported != null && expected != null) {
      computed = invoiceAmountsMatch(reported, expected)
        ? INVOICE_MATCH_STATUS.OK
        : INVOICE_MATCH_STATUS.REQUEST_DIFFERENT;
    } else if (extracted != null && expected != null) {
      computed = invoiceAmountsMatch(extracted, expected)
        ? INVOICE_MATCH_STATUS.OK
        : INVOICE_MATCH_STATUS.REQUEST_DIFFERENT;
    } else {
      computed = INVOICE_MATCH_STATUS.OK;
    }

    // 3. Completed items: extracted now holds the receipt amount — compare vs the request.
    if (submissionStatus === INVOICE_SUBMISSION_STATUS.ACCOUNTING && extracted != null) {
      const requestAmount = reported ?? expected;
      if (requestAmount != null && !invoiceAmountsMatch(extracted, requestAmount)) {
        computed = INVOICE_MATCH_STATUS.RECEIPT_DIFFERENT;
      }
    }

    if (computed === current) {
      keep++;
      continue;
    }
    changes.push({ id: item.id, name: item.name, current: current || "(ריק)", computed });
  }

  console.log(`Scanned ${items.length} invoice items on board ${BOARDS.INVOICES}.`);
  console.log(`Unchanged (already correct): ${keep}`);
  console.log(`To update: ${changes.length}`);
  const fills = changes.filter((c) => c.current === "(ריק)").length;
  console.log(`  fills (empty → value): ${fills}, corrections (wrong → right): ${changes.length - fills}`);
  for (const c of changes) {
    console.log(`  #${c.id} "${c.name}": ${c.current} → ${c.computed}`);
  }

  if (!apply) {
    console.log("\nDry run. Pass --apply to write the corrections.");
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const c of changes) {
    try {
      await updateInvoiceMatchStatus(c.id, c.computed);
      updated++;
      console.log(`updated #${c.id} → ${c.computed}`);
    } catch (err) {
      failed++;
      console.error(`FAILED #${c.id} "${c.name}":`, err);
    }
  }

  console.log(`\nDone. Updated: ${updated}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

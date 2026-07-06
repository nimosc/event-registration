/**
 * One-time migration: normalize existing עוסק פטור invoices to the new two-step flow.
 *
 * Background: previously עוסק פטור submitted a single "קבלה" straight into the
 * accounting-document column (submissionStatus = "הוגש מסמך חשבונאי"). In practice
 * those uploads were actually payment requests. The new flow requires BOTH dealer
 * types to submit a payment request first, then an accounting document after payment.
 *
 * For every עוסק פטור invoice still in the old one-step state this script:
 *   1. Moves the uploaded file from the accounting column to the payment-request column.
 *   2. Clears the accounting column.
 *   3. Sets the invoice submission status back to "הוגשה בקשת תשלום".
 *   4. Sets the linked subitems' invoice status to "הוגשה בקשת תשלום".
 *
 * Dry run by default. Pass --apply to perform the changes.
 *   npx tsx scripts/migrate-exempt-invoices-to-payment-request.ts          # dry run
 *   npx tsx scripts/migrate-exempt-invoices-to-payment-request.ts --apply  # execute
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

type ColumnValue = {
  id: string;
  text: string | null;
  value: string | null;
  linked_item_ids?: string[] | null;
};

type InvoiceAsset = { id: string; name: string; public_url: string | null };

type InvoiceItem = {
  id: string;
  name: string;
  column_values: ColumnValue[];
  assets: InvoiceAsset[] | null;
};

function parseOrderIds(orderIdsText: string | null, orderRelationIds: string[] | null): string[] {
  if (orderIdsText) {
    try {
      const parsed = JSON.parse(orderIdsText) as Array<string | number>;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((v) => String(v));
    } catch {
      // fall back to relation
    }
  }
  return (orderRelationIds ?? []).map((v) => String(v));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const {
    mondayQuery,
    BOARDS,
    getArtistTaxStatus,
    uploadFileToInvoiceColumn,
    updateInvoiceSubmissionStatus,
    updateSubitemsInvoiceStatus,
    getArtistSubitemIdsForOrderIds,
    INVOICE_ACCOUNTING_FILE_COLUMN_ID,
    INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID,
    INVOICE_ARTIST_RELATION_COLUMN_ID,
    INVOICE_ORDER_IDS_COLUMN_ID,
    INVOICE_ORDER_RELATION_COLUMN_ID,
    INVOICE_SUBMISSION_STATUS_COLUMN_ID,
  } = await import("../src/lib/monday");
  const { INVOICE_SUBMISSION_STATUS, SUBITEM_INVOICE_STATUS } = await import(
    "../src/lib/invoiceDocuments"
  );

  const query = `
    query {
      boards(ids: [${BOARDS.INVOICES}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: [
              "${INVOICE_SUBMISSION_STATUS_COLUMN_ID}",
              "${INVOICE_ARTIST_RELATION_COLUMN_ID}",
              "${INVOICE_ORDER_IDS_COLUMN_ID}",
              "${INVOICE_ORDER_RELATION_COLUMN_ID}",
              "${INVOICE_ACCOUNTING_FILE_COLUMN_ID}",
              "${INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID}"
            ]) {
              id
              text
              value
              ... on BoardRelationValue { linked_item_ids }
            }
            assets(column_ids: ["${INVOICE_ACCOUNTING_FILE_COLUMN_ID}"]) {
              id
              name
              public_url
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

  const targets: Array<{
    item: InvoiceItem;
    artistId: number;
    orderIds: string[];
    assets: InvoiceAsset[];
  }> = [];
  let scanned = 0;
  let skippedNotExempt = 0;
  let skippedWrongStatus = 0;
  let skippedNoAccountingFile = 0;
  let skippedHasPaymentRequest = 0;

  for (const item of items) {
    scanned++;
    const byId = (id: string) => item.column_values.find((c) => c.id === id);
    const submissionStatus = (byId(INVOICE_SUBMISSION_STATUS_COLUMN_ID)?.text || "").trim();
    const accountingText = (byId(INVOICE_ACCOUNTING_FILE_COLUMN_ID)?.text || "").trim();
    const paymentRequestText = (byId(INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID)?.text || "").trim();
    const artistRelation = byId(INVOICE_ARTIST_RELATION_COLUMN_ID);
    const artistIdStr = artistRelation?.linked_item_ids?.[0];
    const artistId = artistIdStr ? parseInt(artistIdStr, 10) : NaN;

    if (submissionStatus !== INVOICE_SUBMISSION_STATUS.ACCOUNTING) {
      skippedWrongStatus++;
      continue;
    }
    if (!accountingText) {
      skippedNoAccountingFile++;
      continue;
    }
    if (paymentRequestText) {
      // Already has a payment request → new two-step record, do not touch.
      skippedHasPaymentRequest++;
      continue;
    }
    if (!Number.isFinite(artistId) || artistId <= 0) {
      skippedNotExempt++;
      continue;
    }

    const taxStatus = await getArtistTaxStatus(artistId);
    if (taxStatus !== "פטור") {
      skippedNotExempt++;
      continue;
    }

    const orderIds = parseOrderIds(
      byId(INVOICE_ORDER_IDS_COLUMN_ID)?.text ?? null,
      byId(INVOICE_ORDER_RELATION_COLUMN_ID)?.linked_item_ids ?? null
    );
    const assets = (item.assets ?? []).filter((a) => a.public_url);

    targets.push({ item, artistId, orderIds, assets });
  }

  console.log(`Scanned ${scanned} invoice items on board ${BOARDS.INVOICES}.`);
  console.log(
    `Skipped — wrong status: ${skippedWrongStatus}, no accounting file: ${skippedNoAccountingFile}, ` +
      `already has payment request: ${skippedHasPaymentRequest}, not exempt/no artist: ${skippedNotExempt}.`
  );
  console.log(`Targets (exempt one-step records to migrate): ${targets.length}`);
  for (const t of targets) {
    console.log(
      `  #${t.item.id} "${t.item.name}" — assets: ${t.assets.length}, orders: ${t.orderIds.length}` +
        (t.assets.length === 0 ? "  ⚠ no downloadable asset (public_url missing)" : "")
    );
  }

  if (!apply) {
    console.log("\nDry run. Pass --apply to perform the migration.");
    return;
  }

  let migrated = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      // 1. Move each accounting-column asset to the payment-request column.
      for (const asset of t.assets) {
        const res = await fetch(asset.public_url!);
        if (!res.ok) throw new Error(`download failed (${res.status}) for asset ${asset.id}`);
        const blob = await res.blob();
        await uploadFileToInvoiceColumn(
          t.item.id,
          INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID,
          blob,
          asset.name || `payment-request-${asset.id}`
        );
      }

      // 2. Clear the accounting-document column.
      await mondayQuery(
        `mutation {
          change_column_value(
            board_id: ${BOARDS.INVOICES},
            item_id: ${t.item.id},
            column_id: "${INVOICE_ACCOUNTING_FILE_COLUMN_ID}",
            value: ${JSON.stringify(JSON.stringify({ clearAll: true }))}
          ) { id }
        }`
      );

      // 3. Reset the invoice submission status to "payment request".
      await updateInvoiceSubmissionStatus(t.item.id, INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST);

      // 4. Reset the linked subitems' invoice status.
      if (t.orderIds.length > 0) {
        const subitemIds = await getArtistSubitemIdsForOrderIds(t.orderIds, t.artistId, "");
        if (subitemIds.length > 0) {
          await updateSubitemsInvoiceStatus(subitemIds, SUBITEM_INVOICE_STATUS.PAYMENT_REQUEST);
        }
      }

      migrated++;
      console.log(`migrated #${t.item.id} "${t.item.name}" (${t.assets.length} file/s)`);
    } catch (err) {
      failed++;
      console.error(`FAILED #${t.item.id} "${t.item.name}":`, err);
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

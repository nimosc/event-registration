/**
 * One-off: create the payment-request-number (text) and submission-type (status)
 * columns on the INVOICES board. Prints the new column IDs — copy them into
 * src/lib/monday.ts (INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID / INVOICE_SUBMISSION_TYPE_COLUMN_ID).
 *
 *   npx tsx scripts/create-invoice-columns.ts
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

async function main() {
  const { mondayQuery, BOARDS } = await import("../src/lib/monday");

  const textCol = await mondayQuery<{ create_column: { id: string; title: string } }>(
    `mutation {
      create_column(
        board_id: ${BOARDS.INVOICES},
        title: "מספר בקשת תשלום",
        column_type: text
      ) { id title }
    }`
  );
  console.log(`INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID = "${textCol.create_column.id}"`);

  const statusCol = await mondayQuery<{ create_column: { id: string; title: string } }>(
    `mutation ($defaults: JSON!) {
      create_column(
        board_id: ${BOARDS.INVOICES},
        title: "סוג הגשה",
        column_type: status,
        defaults: $defaults
      ) { id title }
    }`,
    { defaults: JSON.stringify({ labels: { "1": "בקשת תשלום חודשית", "2": "בקשה לבדיקה" } }) }
  );
  console.log(`INVOICE_SUBMISSION_TYPE_COLUMN_ID = "${statusCol.create_column.id}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
 * סימון רטרואקטיבי: כל רשומה ב"בבדיקה" נבדקת לפי אותם קריטריונים של decideInvoiceReview.
 * ברירת מחדל: הרצה יבשה. --apply כותב בפועל (סטטוס + אפדייט).
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const m = await import("../src/lib/monday");
  const { decideInvoiceReview, formatInvoiceReviewUpdate } = await import("../src/lib/invoiceReview");
  const { INVOICE_SUBMISSION_TYPE, INVOICE_MATCH_STATUS } = await import("../src/lib/invoiceDocuments");

  type Item = { id: string; name: string; group: { title: string }; assets: { id: string }[]; column_values: { id: string; text: string; value: string | null; linked_item_ids?: string[] }[] };
  const ids = ["status8", m.INVOICE_SUBMISSION_TYPE_COLUMN_ID, m.INVOICE_MATCH_STATUS_COLUMN_ID, m.INVOICE_AMOUNT_EXPECTED_COLUMN_ID, m.INVOICE_AMOUNT_REPORTED_COLUMN_ID, m.INVOICE_AMOUNT_NOTE_COLUMN_ID, m.INVOICE_FILE_STATUS_COLUMN_ID, m.INVOICE_ARTIST_RELATION_COLUMN_ID, m.INVOICE_BANK_BENEFICIARY_COLUMN_ID, m.INVOICE_BANK_CODE_COLUMN_ID, m.INVOICE_BANK_BRANCH_COLUMN_ID, m.INVOICE_BANK_ACCOUNT_COLUMN_ID];
  const fields = `cursor items { id name group { title } assets { id } column_values(ids: ${JSON.stringify(ids)}) { id text value ... on BoardRelationValue { linked_item_ids } } }`;
  const items: Item[] = [];
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `query { next_items_page(limit: 200, cursor: "${cursor}") { ${fields} } }` : `query { boards(ids: [${m.BOARDS.INVOICES}]) { items_page(limit: 200) { ${fields} } } }`;
    const d = await m.mondayQuery<any>(q);
    const page: { cursor: string | null; items: Item[] } = cursor ? d.next_items_page : d.boards[0].items_page;
    items.push(...page.items); cursor = page.cursor ?? null;
  } while (cursor);
  const col = (it: Item, id: string) => it.column_values.find((c) => c.id === id);
  const inReview = items.filter((it) => (col(it, "status8")?.text || "") === "בבדיקה");
  console.log(`total items: ${items.length}, in "בבדיקה": ${inReview.length}`);

  // bank details stored on artists (one fetch)
  const artistIds = [...new Set(inReview.map((it) => col(it, m.INVOICE_ARTIST_RELATION_COLUMN_ID)?.linked_item_ids?.[0]).filter(Boolean))] as string[];
  const bank = new Map<string, { beneficiaryName: string; bankCode: string; bankBranch: string; bankAccount: string }>();
  for (const aid of artistIds) { try { bank.set(aid, await m.getArtistBankDetailsFields(aid)); } catch { /* keep missing */ } }

  const pass: { it: Item; reasonsNote: string }[] = [];
  const hold: { it: Item; reasons: string[] }[] = [];
  for (const it of inReview) {
    const subType = col(it, m.INVOICE_SUBMISSION_TYPE_COLUMN_ID)?.text || INVOICE_SUBMISSION_TYPE.MONTHLY;
    const match = col(it, m.INVOICE_MATCH_STATUS_COLUMN_ID)?.text || "";
    const expected = parseFloat(col(it, m.INVOICE_AMOUNT_EXPECTED_COLUMN_ID)?.text || "0") || 0;
    const reported = parseFloat(col(it, m.INVOICE_AMOUNT_REPORTED_COLUMN_ID)?.text || "0") || expected;
    const note = col(it, m.INVOICE_AMOUNT_NOTE_COLUMN_ID)?.text || "";
    const aid = col(it, m.INVOICE_ARTIST_RELATION_COLUMN_ID)?.linked_item_ids?.[0];
    const stored = aid ? bank.get(aid) : undefined;
    const bankChanged = !stored ? true :
      stored.beneficiaryName !== (col(it, m.INVOICE_BANK_BENEFICIARY_COLUMN_ID)?.text || "") ||
      stored.bankCode !== (col(it, m.INVOICE_BANK_CODE_COLUMN_ID)?.text || "") ||
      stored.bankBranch !== (col(it, m.INVOICE_BANK_BRANCH_COLUMN_ID)?.text || "") ||
      stored.bankAccount !== (col(it, m.INVOICE_BANK_ACCOUNT_COLUMN_ID)?.text || "");
    const d = decideInvoiceReview({
      submissionType: subType,
      matchStatus: match === INVOICE_MATCH_STATUS.NEEDS_REVIEW ? match : "",
      expectedAmount: expected, reportedAmount: reported, amountNote: note,
      fileAttached: it.assets.length > 0,
      bankDetailsChanged: bankChanged,
    });
    // match status from the record itself is authoritative for old rows
    if (match === INVOICE_MATCH_STATUS.REQUEST_DIFFERENT || match === INVOICE_MATCH_STATUS.RECEIPT_DIFFERENT) {
      if (!d.reasons.some((r) => r.includes("שונה מהסכום"))) d.reasons.push(`סטטוס התאמה ברשומה: ${match}`);
      d.exceptional = true;
    }
    if (d.exceptional) hold.push({ it, reasons: d.reasons }); else pass.push({ it, reasonsNote: "" });
  }

  console.log(`\n=== יעברו ל"העבר לתשלום": ${pass.length} ===`);
  for (const { it } of pass) console.log(`  ${it.id}  ${it.group.title}  ${it.name}`);
  console.log(`\n=== יישארו ב"בבדיקה": ${hold.length} ===`);
  const why: Record<string, number> = {};
  for (const { reasons } of hold) for (const r of reasons) { const k = r.split(" — ")[0].replace(/\(.*?\)/g, "(…)"); why[k] = (why[k] || 0) + 1; }
  for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

  if (!apply) { console.log("\n(הרצה יבשה — לא נכתב כלום. --apply לביצוע)"); return; }
  let moved = 0, annotated = 0;
  for (const { it } of pass) {
    await m.setInvoicePaymentStatus(it.id, m.INVOICE_PAYMENT_STATUS.TRANSFER);
    moved++;
  }
  for (const { it, reasons } of hold) {
    await m.createInvoiceUpdate(it.id, "🔁 סיווג רטרואקטיבי — " + formatInvoiceReviewUpdate({ exceptional: true, reasons }));
    annotated++;
  }
  console.log(`\nהועברו ל"העבר לתשלום": ${moved} | נכתב אפדייט עם סיבות על: ${annotated}`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });

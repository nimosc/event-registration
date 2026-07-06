# Payment-Request Number & Submission-Type Columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the payment-request document number from leaking into the invoice/receipt number column; record it in a dedicated Monday column, and tag every invoice item as "monthly payment request" vs "review request".

**Architecture:** Two new Monday columns on the INVOICES board (5097191457), created via API by a one-off script whose printed IDs get hardcoded in `src/lib/monday.ts`. The initial-submission route writes the extracted number to the new column and the submission type on create. The receipt modal opens empty. The existing migration script gains a backfill pass.

**Tech Stack:** Next.js 15 App Router, Monday.com GraphQL API, TypeScript, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-07-06-payment-request-number-and-submission-type-design.md`

## Global Constraints

- **No test suite is configured** in this repo (per CLAUDE.md). The test gate for every task is `npx tsc --noEmit` (must pass with no output) plus the manual verification steps in Task 7. Do not add a test framework.
- All UI/label text is Hebrew. Copy strings **verbatim** from this plan.
- `npm run lint` is broken repo-wide (`next lint` removed in Next 16) — do not attempt to fix it here; use `npx tsc --noEmit`.
- Status labels (exact): `בקשת תשלום חודשית`, `בקשה לבדיקה`. Column titles (exact): `מספר בקשת תשלום`, `סוג הגשה`.
- Monday board: `BOARDS.INVOICES = 5097191457`. Existing columns referenced: `INVOICE_NUMBER_COLUMN_ID = "text_mm3p1e0e"`, `INVOICE_DESCRIPTION_COLUMN_ID = "text_17"`.
- `.env.local` holds `MONDAY_API_TOKEN`; scripts load it via the `loadEnvLocal()` pattern already used in `scripts/`.

---

### Task 1: Create the two Monday columns and capture their IDs

**Files:**
- Create: `scripts/create-invoice-columns.ts`

**Interfaces:**
- Produces: two live Monday columns on board 5097191457 and their column IDs printed to stdout. Task 2 hardcodes those IDs.

- [ ] **Step 1: Write the script**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (pass).

- [ ] **Step 3: Run the script against Monday**

Run: `npx tsx scripts/create-invoice-columns.ts`
Expected output (IDs will differ):
```
INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID = "text_mmXXXXX"
INVOICE_SUBMISSION_TYPE_COLUMN_ID = "color_mmXXXXX"
```
**Record both IDs — Task 2 needs them.** If Monday returns an error that a column with that title exists, query the board's columns (`boards(ids:[5097191457]){ columns { id title type } }` via a quick tsx snippet) and reuse the existing IDs instead of creating duplicates.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-invoice-columns.ts
git commit -m "chore: add one-off script creating invoice payment-request-number and submission-type columns"
```

---

### Task 2: Wire the new columns into `createInvoiceItem`

**Files:**
- Modify: `src/lib/monday.ts` (constants near line 27-34; `createInvoiceItem` params interface near line 1770 and colValues block near line 1795-1812)
- Modify: `src/lib/invoiceDocuments.ts` (add submission-type labels)

**Interfaces:**
- Consumes: column IDs printed by Task 1.
- Produces:
  - `export const INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID: string` and `export const INVOICE_SUBMISSION_TYPE_COLUMN_ID: string` in `src/lib/monday.ts`.
  - `createInvoiceItem` accepts optional `paymentRequestNumber?: string` and `submissionType?: string`.
  - `export const INVOICE_SUBMISSION_TYPE = { MONTHLY: "בקשת תשלום חודשית", REVIEW: "בקשה לבדיקה" } as const` in `src/lib/invoiceDocuments.ts`.

- [ ] **Step 1: Add the column constants in `src/lib/monday.ts`**

Directly below the existing line `export const INVOICE_SUBMISSION_STATUS_COLUMN_ID = "color_mm4699gb"; // סטטוס הגשה` add (substituting the real IDs from Task 1):

```ts
export const INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID = "<ID from Task 1>"; // מספר בקשת תשלום
export const INVOICE_SUBMISSION_TYPE_COLUMN_ID = "<ID from Task 1>";        // סוג הגשה: בקשת תשלום חודשית / בקשה לבדיקה
```

- [ ] **Step 2: Add the labels constant in `src/lib/invoiceDocuments.ts`**

Below the `SUBITEM_INVOICE_STATUS` block add:

```ts
/** Invoice board column "סוג הגשה" */
export const INVOICE_SUBMISSION_TYPE = {
  MONTHLY: "בקשת תשלום חודשית",
  REVIEW: "בקשה לבדיקה",
} as const;
```

- [ ] **Step 3: Extend `createInvoiceItem`**

In the params interface (the one containing `invoiceNumber: string;` near line 1772), add after `submissionStatus?: string;`:

```ts
  paymentRequestNumber?: string; // בקשת תשלום document number (kept separate from invoiceNumber)
  submissionType?: string;       // בקשת תשלום חודשית / בקשה לבדיקה
```

In the colValues block, after the line `if (params.invoiceNumber) colValues[INVOICE_NUMBER_COLUMN_ID] = params.invoiceNumber;` add:

```ts
  if (params.paymentRequestNumber) {
    colValues[INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID] = params.paymentRequestNumber;
  }
  if (params.submissionType) {
    colValues[INVOICE_SUBMISSION_TYPE_COLUMN_ID] = { label: params.submissionType };
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/monday.ts src/lib/invoiceDocuments.ts
git commit -m "feat: add payment-request-number and submission-type columns to invoice creation"
```

---

### Task 3: Route the number and submission type in POST /api/invoices

**Files:**
- Modify: `src/app/api/invoices/route.ts` (imports near line 26; `createInvoiceItem` call near line 223-244)

**Interfaces:**
- Consumes: `INVOICE_SUBMISSION_TYPE` from `@/lib/invoiceDocuments`; extended `createInvoiceItem` from Task 2.
- Produces: new invoice items carry the payment-request number in the new column, an **empty** `text_mm3p1e0e`, and a submission-type label.

- [ ] **Step 1: Import the labels**

Change the existing import line
`import { getInitialDocumentForTaxStatus, INVOICE_SUBMISSION_STATUS } from "@/lib/invoiceDocuments";`
to:

```ts
import {
  getInitialDocumentForTaxStatus,
  INVOICE_SUBMISSION_STATUS,
  INVOICE_SUBMISSION_TYPE,
} from "@/lib/invoiceDocuments";
```

- [ ] **Step 2: Redirect the number and add the type in the `createInvoiceItem` call**

In the call (near line 223), replace the line `invoiceNumber,` with:

```ts
    invoiceNumber: "",
    paymentRequestNumber: invoiceNumber,
    submissionType: voluntarySubmission
      ? INVOICE_SUBMISSION_TYPE.REVIEW
      : INVOICE_SUBMISSION_TYPE.MONTHLY,
```

(`invoiceNumber` here is the form value extracted from the payment-request file — it is a payment-request number now, never a receipt number, because the initial submission is always `kind: "payment_request"`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (pass).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/invoices/route.ts
git commit -m "feat: store payment-request number separately and tag submission type on invoice creation"
```

---

### Task 4: UI — empty receipt-number field and relabeled payment-request field

**Files:**
- Modify: `src/app/invoices/InvoicesClient.tsx`
  - `openAccountingModal` definition (~line 473-480)
  - call sites at ~lines 928, 975-978, 1120, 1176
  - field labels at ~lines 1286 and 1540

**Interfaces:**
- Consumes: nothing new.
- Produces: `openAccountingModal(invoiceId: string)` — single-argument signature; the accounting modal's number field always starts empty.

- [ ] **Step 1: Make the accounting modal open with an empty number**

Change the definition:

```ts
  const openAccountingModal = useCallback((invoiceId: string) => {
    setAccountingInvoiceId(invoiceId);
    setAccountingFile(null);
    setAccountingInvoiceNumber("");
    setAccountingExtractedAmount(null);
    setAccountingExtractedNumber("");
    setShowAccountingModal(true);
  }, []);
```

- [ ] **Step 2: Update the four call sites to pass only the id**

1. ~line 928: `onClick={() => openAccountingModal(inv.id, inv.invoiceNumber || "")}` → `onClick={() => openAccountingModal(inv.id)}`
2. ~lines 973-978 (month-header button): the whole `onClick` body becomes `openAccountingModal(pendingAccountingInvoiceIdForSelectedMonth)` — delete the `const inv = ...` lookup that only served the second argument.
3. ~line 1118-1122 (table row): replace the block

```ts
                                  onClick={() => {
                                    const invId = accountingInvoiceId || reg.linkedInvoiceId || "";
                                    const inv = invoices.find((i) => i.id === invId);
                                    openAccountingModal(invId, inv?.invoiceNumber || "");
                                  }}
```

with:

```ts
                                  onClick={() =>
                                    openAccountingModal(accountingInvoiceId || reg.linkedInvoiceId || "")
                                  }
```

**Naming caution:** inside this table row the local variable is `accountingInvoiceId` from `resolveInvoiceIdForRegistration(...)` — keep exactly the existing expression, only drop the lookup and second arg.

4. ~line 1176 ("My invoices" table): `onClick={() => openAccountingModal(inv.id, inv.invoiceNumber || "")}` → `onClick={() => openAccountingModal(inv.id)}`

- [ ] **Step 3: Relabel the payment-request number field (2 places)**

- ~line 1286 (voluntary modal): `placeholder="מספר חשבונית / קבלה"` → `placeholder="מספר בקשת תשלום"`
- ~line 1540 (month modal): `<label ...>מספר חשבונית / קבלה</label>` → `<label ...>מספר בקשת תשלום</label>`

Do **not** touch line ~1674 — that is the accounting (receipt) modal where "מספר חשבונית / קבלה" is correct.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (pass). Also confirm no remaining two-argument calls: `grep -n "openAccountingModal(" src/app/invoices/InvoicesClient.tsx` shows only single-argument calls plus the definition.

- [ ] **Step 5: Commit**

```bash
git add src/app/invoices/InvoicesClient.tsx
git commit -m "fix: open receipt modal with empty number and relabel payment-request number field"
```

---

### Task 5: Backfill in the migration script

**Files:**
- Modify: `scripts/migrate-exempt-invoices-to-payment-request.ts`

**Interfaces:**
- Consumes: `INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID`, `INVOICE_SUBMISSION_TYPE_COLUMN_ID`, `INVOICE_NUMBER_COLUMN_ID`, `INVOICE_DESCRIPTION_COLUMN_ID` from `../src/lib/monday`; `INVOICE_SUBMISSION_TYPE` from `../src/lib/invoiceDocuments`.
- Produces: same CLI (`--apply` / dry-run) now also backfills submission type for **all** items and moves payment-request numbers.

- [ ] **Step 1: Extend the destructured import and the items query**

Add to the `await import("../src/lib/monday")` destructuring: `INVOICE_NUMBER_COLUMN_ID`, `INVOICE_DESCRIPTION_COLUMN_ID`, `INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID`, `INVOICE_SUBMISSION_TYPE_COLUMN_ID`.
Add to the `await import("../src/lib/invoiceDocuments")` destructuring: `INVOICE_SUBMISSION_TYPE`.
Add these four column ids to the `column_values(ids: [...])` list in the GraphQL query:

```
              "${INVOICE_NUMBER_COLUMN_ID}",
              "${INVOICE_DESCRIPTION_COLUMN_ID}",
              "${INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID}",
              "${INVOICE_SUBMISSION_TYPE_COLUMN_ID}"
```

- [ ] **Step 2: Collect backfill work during the scan**

The existing loop `for (const item of items)` currently `continue`s early for non-targets. Restructure: compute backfill needs **before** the target-filter checks. Insert after the existing `const` declarations (`byId`, `submissionStatus`, `accountingText`, `paymentRequestText`, `artistRelation`, `artistId`) and **before** the first `if (submissionStatus !== ...)` check:

```ts
    const invoiceNumberText = (byId(INVOICE_NUMBER_COLUMN_ID)?.text || "").trim();
    const descriptionText = (byId(INVOICE_DESCRIPTION_COLUMN_ID)?.text || "").trim();
    const paymentRequestNumberText = (byId(INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID)?.text || "").trim();
    const submissionTypeText = (byId(INVOICE_SUBMISSION_TYPE_COLUMN_ID)?.text || "").trim();

    // Backfill 1: submission type for every item that doesn't have one yet.
    if (!submissionTypeText) {
      typeBackfills.push({
        itemId: item.id,
        name: item.name,
        submissionType: descriptionText.startsWith("הגשה ידנית — חסר במערכת")
          ? INVOICE_SUBMISSION_TYPE.REVIEW
          : INVOICE_SUBMISSION_TYPE.MONTHLY,
      });
    }

    // Backfill 2: items sitting at the payment-request stage have a payment-request
    // number stored in the invoice-number column — move it. Exempt one-step items
    // (this script's main targets) reach that stage during this run, so include them below.
    const atPaymentRequestStage = submissionStatus === INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST;
    if (atPaymentRequestStage && invoiceNumberText && !paymentRequestNumberText) {
      numberMoves.push({ itemId: item.id, name: item.name, number: invoiceNumberText });
    }
```

Declare the accumulators before the loop:

```ts
  const typeBackfills: Array<{ itemId: string; name: string; submissionType: string }> = [];
  const numberMoves: Array<{ itemId: string; name: string; number: string }> = [];
```

`INVOICE_SUBMISSION_STATUS` is already imported. **Also**, inside the block where an exempt target is pushed to `targets` (after the tax-status check passes), add the same number move for the converting item:

```ts
    if (invoiceNumberText && !paymentRequestNumberText) {
      numberMoves.push({ itemId: item.id, name: item.name, number: invoiceNumberText });
    }
```

- [ ] **Step 3: Report and apply the backfills**

Extend the dry-run report (before the `if (!apply)` return):

```ts
  console.log(`Submission-type backfills: ${typeBackfills.length}`);
  console.log(`Payment-request number moves: ${numberMoves.length}`);
```

After the existing exempt-migration `for` loop (still inside `apply` mode), add:

```ts
  for (const b of typeBackfills) {
    try {
      await mondayQuery(
        `mutation {
          change_column_value(
            board_id: ${BOARDS.INVOICES},
            item_id: ${b.itemId},
            column_id: "${INVOICE_SUBMISSION_TYPE_COLUMN_ID}",
            value: ${JSON.stringify(JSON.stringify({ label: b.submissionType }))}
          ) { id }
        }`
      );
      console.log(`type-backfill #${b.itemId} → ${b.submissionType}`);
    } catch (err) {
      console.error(`FAILED type-backfill #${b.itemId} "${b.name}":`, err);
    }
  }

  for (const m of numberMoves) {
    try {
      await mondayQuery(
        `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
        }`,
        {
          boardId: String(BOARDS.INVOICES),
          itemId: m.itemId,
          columnValues: JSON.stringify({
            [INVOICE_PAYMENT_REQUEST_NUMBER_COLUMN_ID]: m.number,
            [INVOICE_NUMBER_COLUMN_ID]: "",
          }),
        }
      );
      console.log(`number-move #${m.itemId} → "${m.number}"`);
    } catch (err) {
      console.error(`FAILED number-move #${m.itemId} "${m.name}":`, err);
    }
  }
```

- [ ] **Step 4: Type-check and dry-run**

Run: `npx tsc --noEmit` → no output.
Run: `npx tsx scripts/migrate-exempt-invoices-to-payment-request.ts`
Expected: the existing scan summary plus two new lines (`Submission-type backfills: N`, `Payment-request number moves: N`) and `Dry run. Pass --apply ...`. **Do not run `--apply`** — the user runs that deliberately.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-exempt-invoices-to-payment-request.ts
git commit -m "feat: backfill submission type and move payment-request numbers in invoice migration"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds; route list includes `/invoices` and `/api/invoices`.

- [ ] **Step 2: Browser verification (dev server on port 3150, launch config `next-dev`)**

1. Log in as the test artist (magic link `GET /?ID=2880122232` was used earlier in this session).
2. `/invoices` → open the month payment-request modal: number field label reads **"מספר בקשת תשלום"**.
3. Submit a payment request with a file; in Monday verify: new column `מספר בקשת תשלום` holds the number, `text_mm3p1e0e` (מספר חשבונית) is **empty**, `סוג הגשה` = `בקשת תשלום חודשית`.
4. Open the receipt modal for that record: number field is **empty** (this was the reported bug).
5. Voluntary modal ("חסר במערכת?") submission → `סוג הגשה` = `בקשה לבדיקה`.
6. Report all findings to the user; ask before running the migration `--apply`.

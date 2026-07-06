# Invoice Match-Status Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-set a new Monday status column "סטטוס התאמה" (תקין / בקשת תשלום שונה / קבלה שונה מהבקשת תשלום) on invoice items, and accept-and-flag mismatched receipts instead of blocking them.

**Architecture:** One new status column on the INVOICES board (5097191457), created via API and hardcoded like text_mm50g77q. Stage-1 status is written at item creation (`createInvoiceItem` gains `matchStatus`); stage-2 mismatches call a new `updateInvoiceMatchStatus`. The accounting route keeps blocking number mismatches but accepts amount mismatches. The client turns its amount block into a warning.

**Tech Stack:** Next.js 15 App Router, Monday GraphQL, TypeScript, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-07-06-invoice-match-status-design.md`

## Global Constraints

- No test suite exists (CLAUDE.md); the gate per task is `npx tsc --noEmit` with no output. `npm run lint` is broken repo-wide — do not use it.
- Hebrew strings verbatim: column title `סטטוס התאמה`; labels `תקין`, `בקשת תשלום שונה`, `קבלה שונה מהבקשת תשלום`.
- Amount comparison uses the existing `invoiceAmountsMatch(a, b)` (tolerance 0.009) from `src/lib/invoiceValidation.ts`, re-exported by `src/lib/invoiceAiValidation.ts`.
- No backfill for existing items.
- Working tree contains unrelated uncommitted user WIP — `git add` only the files each task names.

---

### Task 1: Create the Monday column and capture its ID

**Files:**
- Create: `scripts/create-match-status-column.ts`

**Interfaces:**
- Produces: live status column on board 5097191457; prints `INVOICE_MATCH_STATUS_COLUMN_ID = "<id>"` for Task 2.

- [ ] **Step 1: Write the script** — copy the `loadEnvLocal()` header pattern from `scripts/create-invoice-columns.ts`, then:

```ts
async function main() {
  const { mondayQuery, BOARDS } = await import("../src/lib/monday");
  const statusCol = await mondayQuery<{ create_column: { id: string; title: string } }>(
    `mutation ($defaults: JSON!) {
      create_column(
        board_id: ${BOARDS.INVOICES},
        title: "סטטוס התאמה",
        column_type: status,
        defaults: $defaults
      ) { id title }
    }`,
    { defaults: JSON.stringify({ labels: { "1": "תקין", "2": "בקשת תשלום שונה", "3": "קבלה שונה מהבקשת תשלום" } }) }
  );
  console.log(`INVOICE_MATCH_STATUS_COLUMN_ID = "${statusCol.create_column.id}"`);
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2:** `npx tsc --noEmit` → no output.
- [ ] **Step 3:** `npx tsx scripts/create-match-status-column.ts` → record the printed ID. If the column already exists, query board columns and reuse the existing ID.
- [ ] **Step 4:** `git add scripts/create-match-status-column.ts && git commit -m "chore: add one-off script creating invoice match-status column"`

---

### Task 2: Constants and Monday write helpers

**Files:**
- Modify: `src/lib/monday.ts` (constants block ~line 34-36; `createInvoiceItem` params ~1768 and colValues ~1798; next to `updateInvoiceSubmissionStatus` ~1930)
- Modify: `src/lib/invoiceDocuments.ts` (below `INVOICE_SUBMISSION_TYPE`)

**Interfaces:**
- Produces: `INVOICE_MATCH_STATUS_COLUMN_ID` (monday.ts); `createInvoiceItem` param `matchStatus?: string`; `updateInvoiceMatchStatus(invoiceItemId: string, matchStatus: string): Promise<void>`; `INVOICE_MATCH_STATUS = { OK: "תקין", REQUEST_DIFFERENT: "בקשת תשלום שונה", RECEIPT_DIFFERENT: "קבלה שונה מהבקשת תשלום" } as const`.

- [ ] **Step 1:** In monday.ts, below `INVOICE_SUBMISSION_TYPE_COLUMN_ID` add (real ID from Task 1):

```ts
export const INVOICE_MATCH_STATUS_COLUMN_ID = "<ID from Task 1>"; // סטטוס התאמה: תקין / בקשת תשלום שונה / קבלה שונה מהבקשת תשלום
```

- [ ] **Step 2:** In invoiceDocuments.ts, below the `INVOICE_SUBMISSION_TYPE` block add:

```ts
/** Invoice board column "סטטוס התאמה" */
export const INVOICE_MATCH_STATUS = {
  OK: "תקין",
  REQUEST_DIFFERENT: "בקשת תשלום שונה",
  RECEIPT_DIFFERENT: "קבלה שונה מהבקשת תשלום",
} as const;
```

- [ ] **Step 3:** In `createInvoiceItem` params, after `submissionType?: string;` add:

```ts
  matchStatus?: string;          // סטטוס התאמה: תקין / בקשת תשלום שונה / קבלה שונה מהבקשת תשלום
```

In the colValues block, after the `submissionType` if-block add:

```ts
  if (params.matchStatus) {
    colValues[INVOICE_MATCH_STATUS_COLUMN_ID] = { label: params.matchStatus };
  }
```

- [ ] **Step 4:** Below `updateInvoiceSubmissionStatus` add:

```ts
export async function updateInvoiceMatchStatus(
  invoiceItemId: string,
  matchStatus: string
): Promise<void> {
  await mondayQuery(
    `mutation {
      change_column_value(
        board_id: ${BOARDS.INVOICES},
        item_id: ${invoiceItemId},
        column_id: "${INVOICE_MATCH_STATUS_COLUMN_ID}",
        value: ${JSON.stringify(JSON.stringify({ label: matchStatus }))}
      ) { id }
    }`
  );
}
```

- [ ] **Step 5:** `npx tsc --noEmit` → no output.
- [ ] **Step 6:** `git add src/lib/monday.ts src/lib/invoiceDocuments.ts && git commit -m "feat: add invoice match-status column constant and write helpers"`

---

### Task 3: Stage-1 status in POST /api/invoices

**Files:**
- Modify: `src/app/api/invoices/route.ts` (imports ~line 26-31; `createInvoiceItem` call ~line 228)

**Interfaces:**
- Consumes: `INVOICE_MATCH_STATUS` from `@/lib/invoiceDocuments`; `invoiceAmountsMatch` from `@/lib/invoiceAiValidation`; `matchStatus` param from Task 2.

- [ ] **Step 1:** Add `INVOICE_MATCH_STATUS` to the `@/lib/invoiceDocuments` import and `invoiceAmountsMatch` to the `@/lib/invoiceAiValidation` import.
- [ ] **Step 2:** In the `createInvoiceItem` call, after the `submissionType: ...` lines add:

```ts
    matchStatus:
      voluntarySubmission || invoiceAmountsMatch(reportedAmount, resolvedAmount)
        ? INVOICE_MATCH_STATUS.OK
        : INVOICE_MATCH_STATUS.REQUEST_DIFFERENT,
```

(`reportedAmount` = `resolvedActualAmount ?? resolvedAmount` is already computed at ~line 203; for voluntary submissions there is no system-calculated amount, so they are always `תקין`.)

- [ ] **Step 3:** `npx tsc --noEmit` → no output.
- [ ] **Step 4:** `git add src/app/api/invoices/route.ts && git commit -m "feat: set invoice match status on payment-request submission"`

---

### Task 4: Stage-2 accept-and-flag in the accounting route

**Files:**
- Modify: `src/app/api/invoices/accounting-document/route.ts` (imports ~line 3-27; validation block ~line 111-122; after `updateInvoiceSubmissionStatus` ~line 129)

**Interfaces:**
- Consumes: `updateInvoiceMatchStatus` from `@/lib/monday`; `INVOICE_MATCH_STATUS` from `@/lib/invoiceDocuments`; `invoiceAmountsMatch` from `@/lib/invoiceAiValidation`.

- [ ] **Step 1:** Add `updateInvoiceMatchStatus` to the `@/lib/monday` import, `INVOICE_MATCH_STATUS` to the `@/lib/invoiceDocuments` import, and `invoiceAmountsMatch` to the `@/lib/invoiceAiValidation` import.
- [ ] **Step 2:** Replace the validation block

```ts
    const expectedAmount = invoice.reportedAmount || invoice.actualAmount || invoice.amount;
    const extracted = await extractInvoiceDataWithTimeout(file);
    const validationError = validateExtractedAgainstExpected({
      extracted,
      expectedAmount,
      declaredNumber: invoiceNumber,
      requireAmountWhenExtracted: true,
      requireNumberWhenBothPresent: true,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
```

with:

```ts
    const expectedAmount = invoice.reportedAmount || invoice.actualAmount || invoice.amount;
    const extracted = await extractInvoiceDataWithTimeout(file);
    // Typo guard: a declared number that contradicts the file still blocks.
    const numberError = validateExtractedAgainstExpected({
      extracted,
      expectedAmount,
      declaredNumber: invoiceNumber,
      requireAmountWhenExtracted: false,
      requireNumberWhenBothPresent: true,
    });
    if (numberError) {
      return NextResponse.json({ error: numberError }, { status: 400 });
    }
    // Amount mismatch vs the payment request is accepted and flagged for admin review.
    const receiptAmountMismatch =
      extracted?.amount != null && !invoiceAmountsMatch(extracted.amount, expectedAmount);
```

- [ ] **Step 3:** After the `await updateInvoiceSubmissionStatus(...)` line add:

```ts
    if (receiptAmountMismatch) {
      await updateInvoiceMatchStatus(invoiceId, INVOICE_MATCH_STATUS.RECEIPT_DIFFERENT);
    }
```

- [ ] **Step 4:** `npx tsc --noEmit` → no output.
- [ ] **Step 5:** `git add src/app/api/invoices/accounting-document/route.ts && git commit -m "feat: accept mismatched receipts and flag match status instead of blocking"`

---

### Task 5: Client — amount mismatch becomes a warning

**Files:**
- Modify: `src/app/invoices/InvoicesClient.tsx` (memo ~line 517-538; submit handler ~line 556 and deps ~line 600; modal render ~line 1708-1712 and disabled ~line 1725)

**Interfaces:**
- Consumes: existing `validateExtractedAgainstExpected` import.
- Produces: `accountingNumberError` (blocks) and `accountingAmountWarning` (informs) replacing `accountingValidationError` everywhere.

- [ ] **Step 1:** Replace the `accountingValidationError` memo with two memos (same deps array each):

```ts
  const accountingNumberError = useMemo(() => {
    if (!accountingInvoice || !accountingFile) return null;
    const expectedAmount =
      accountingInvoice.reportedAmount ?? accountingInvoice.actualAmount ?? accountingInvoice.amount;
    return validateExtractedAgainstExpected({
      extracted: {
        receiptNumber: accountingExtractedNumber || accountingInvoiceNumber || null,
        amount: accountingExtractedAmount,
        description: null,
      },
      expectedAmount,
      declaredNumber: accountingInvoiceNumber,
      requireAmountWhenExtracted: false,
      requireNumberWhenBothPresent: true,
    });
  }, [
    accountingExtractedAmount,
    accountingExtractedNumber,
    accountingFile,
    accountingInvoice,
    accountingInvoiceNumber,
  ]);

  const accountingAmountWarning = useMemo(() => {
    if (!accountingInvoice || !accountingFile) return null;
    const expectedAmount =
      accountingInvoice.reportedAmount ?? accountingInvoice.actualAmount ?? accountingInvoice.amount;
    return validateExtractedAgainstExpected({
      extracted: {
        receiptNumber: null,
        amount: accountingExtractedAmount,
        description: null,
      },
      expectedAmount,
      requireAmountWhenExtracted: true,
      requireNumberWhenBothPresent: false,
    });
  }, [accountingExtractedAmount, accountingFile, accountingInvoice]);
```

- [ ] **Step 2:** In `handleSubmitAccountingDocument` replace

```ts
    if (accountingValidationError) {
      setError(accountingValidationError);
      return;
    }
```

with:

```ts
    if (accountingNumberError) {
      setError(accountingNumberError);
      return;
    }
```

and in its deps array replace `accountingValidationError,` with `accountingNumberError,`.

- [ ] **Step 3:** In the modal render replace the red error box with:

```tsx
              {accountingNumberError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {accountingNumberError}
                </div>
              )}
              {!accountingNumberError && accountingAmountWarning && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {accountingAmountWarning}
                  <div className="mt-1 font-medium">ניתן להגיש — הרשומה תסומן לבדיקת מנהל.</div>
                </div>
              )}
```

and in the submit button's `disabled` replace `Boolean(accountingValidationError)` with `Boolean(accountingNumberError)`.

- [ ] **Step 4:** `npx tsc --noEmit` → no output; `grep -n "accountingValidationError" src/app/invoices/InvoicesClient.tsx` → no matches.
- [ ] **Step 5:** `git add src/app/invoices/InvoicesClient.tsx && git commit -m "feat: allow mismatched receipt amounts with an admin-review warning"`

---

### Task 6: Verification

- [ ] `npm run build` succeeds.
- [ ] Browser (dev 3150, נועם טסט): open the receipt modal for the April invoice, attach a file — if extraction returns a different amount, an amber warning shows and submit stays enabled; a contradicting typed number shows red and disables submit.
- [ ] Live Monday check: new submissions carry `סטטוס התאמה`; verify the column exists with the three labels.
- [ ] Report results; deploy only if the user asks.

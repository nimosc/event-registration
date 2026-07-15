# Invoice Submission Speedup Implementation Plan

**Goal:** Cut invoice/document submission from ~15s to ~4-6s, plus a close-tab guard during submission.

**Approach (approved by Noam):**
1. **Skip double AI extraction** — `/api/invoices/extract` returns an HMAC-signed token (JWT_SECRET) binding the extracted fields to a SHA-256 of the file. Submit routes verify hash+signature and reuse the fields; fall back to server extraction when absent/invalid.
2. **Parallelize independent Monday calls** — initial reads (tax status / existing invoices / orders) via Promise.all; relation mutations inside `createInvoiceItem` in parallel; file upload alongside bank-details read.
3. **Defer non-critical writes** with `after()` from `next/server` — subitem linking/status + bank-details update run after the response.
4. **Client**: non-blocking refresh after success + `beforeunload` warning while submitting.

**Files:**
- Create: `src/lib/extractionToken.ts` (sign/verify, node:crypto HMAC-SHA256, 30-min expiry)
- Modify: `src/app/api/invoices/extract/route.ts` (issue token)
- Modify: `src/app/api/invoices/route.ts` (parallel reads, token verify, after())
- Modify: `src/app/api/invoices/accounting-document/route.ts` (token verify, after())
- Modify: `src/lib/monday.ts` (`createInvoiceItem` — parallel relation mutations)
- Modify: `src/app/invoices/InvoicesClient.tsx` (token state for both upload paths, beforeunload guard, background refresh)

**Verification:**
1. `npx tsc --noEmit` + `npm run build`.
2. Unit check of extractionToken sign/verify (tsx one-off): valid round-trip, wrong hash rejected, expiry rejected.
3. Browser: attach file → extract response includes token; submit path sends it.
4. Timed e2e: voluntary submission for the test artist via authenticated fetch, measure duration (~expect <7s), verify item created in Monday, then delete the test item.
5. Deploy to Vercel on approval.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

No test suite is configured.

## Environment Setup

Copy `.env.local.example` to `.env.local`:

| Variable | Required | Description |
|---|---|---|
| `MONDAY_API_TOKEN` | ✅ | Monday.com API token (Profile → Developers → API) |
| `JWT_SECRET` | ✅ | Random string for signing session cookies |
| `NEXT_PUBLIC_URL` | — | Public base URL for absolute redirects |
| `ADMIN_CANDIDACY_APPROVED_WEBHOOK_URL` | — | POST target when admin approves/rejects candidacy |

## Architecture

This is a **Next.js 15 App Router** app (Hebrew/RTL) for managing artist registrations for events. The backend is entirely **Monday.com** — there is no database. All data is read from and written to Monday.com boards via GraphQL.

### Data Layer (`src/lib/monday.ts`)

All Monday.com interaction lives here. Key board IDs:

```ts
BOARDS = {
  ARTISTS:       5092847546,   // Artist master data and credentials
  ORDERS:        5092847547,   // Event orders
  SUBITEMS:      5092847598,   // Registrations (subitems of ORDERS items)
  ISSUE_REPORTS: 5094343821,   // User-submitted bug/issue reports
}
```

All column IDs are hardcoded strings in `monday.ts`. Notable columns:

**ORDERS board:** `color_mm18ej76` = order status, `numeric_mm185aw7` = artists required, `numeric_mm18d914` = artists assigned, `numeric_mm387qc7` = ODT required, `numeric_mm3b6rnr` = ODT assigned.

**SUBITEMS board:** `board_relation_mm18r4da` = linked artist, `color_mm18bjdk` = attendance status, `color_mm1q61p2` = candidacy status.

Order status constants (used as filter values and in mutations):
- `STATUS_OPEN` = `"בתהליך שיבוץ"`
- `STATUS_CANDIDACY_CLOSED` = `"סגירת קבלת מועמדויות"`
- `STATUS_ASSIGNMENT_DONE` = `"הסתיים השיבוץ"`
- `STATUS_CANCELLED` = `"בוטל"`

**Capacity rule:** an order closes to new artist registrations when `assignedCount >= Math.ceil(requiredCount * 1.5)`.

Dropdown column values from Monday are returned as double-stringified JSON in the `value` field. Use `parseDropdownLabel()` when reading dropdown columns.

### Auth (`src/lib/auth.ts` + `src/middleware.ts`)

- Login validates credentials against the Artists board
- On success, a **JWT** (HS256, 7-day expiry) is set as an HttpOnly cookie named `session`
- `SessionUser` shape: `{ id, name, role, status, location? }` where `role` is `"אומן"` (artist), `"מנהל"` (admin), or `"ODT"`
- `/api/orders` refreshes the artist's role from Monday on every call and re-issues the JWT if it changed
- Middleware protects `/orders`, `/my-registrations`, `/admin` — redirecting to `/` if unauthenticated
- `/admin` requires `role === "מנהל"`; other roles are redirected to `/orders`
- **Magic link:** `GET /api/magic-link?id=<artistMondayItemId>` creates a session without credentials (for external flows)

### Page/Component Pattern

Each page follows this split:
- `page.tsx` — Server component: reads session via `getSession()`, enforces auth, passes user to client
- `*Client.tsx` — Client component: all UI state, data fetching via `fetch()` to API routes

### API Routes (`src/app/api/`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth` | POST/DELETE | — | Login / Logout |
| `/api/magic-link` | GET | — | Passwordless auth via artist Monday ID |
| `/api/orders` | GET | ✅ | Open orders filtered by role and location |
| `/api/register` | POST/DELETE | ✅ | Register / Unregister for an order |
| `/api/my-registrations` | GET | ✅ | Artist's own registration history |
| `/api/admin/orders` | GET | Admin | All orders with subitems |
| `/api/admin/confirm` | PATCH | Admin | Approve/reject candidacy or attendance |
| `/api/admin/assign` | POST | Admin | Manually assign an artist to an order |
| `/api/admin/assignable-artists` | GET | Admin | Artists eligible for a given order |
| `/api/profile/location` | PATCH | ✅ | Update artist's location preference |
| `/api/profile/location/options` | GET | ✅ | Available location dropdown options |
| `/api/report-issue` | POST | ✅ | Submit a bug/issue to ISSUE_REPORTS board |
| `/api/account-recovery` | POST | — | Phone-based recovery via Make.com webhook |

### Registration & Assignment Flow

**Self-registration (artist):**
1. Artist registers → `createSubitem()` (two mutations: create + set `board_relation`)
2. `updateAssignedCount()` increments the numeric assigned column
3. If `assignedCount >= Math.ceil(requiredCount * 1.5)` → `updateOrderStatus(STATUS_ASSIGNMENT_DONE)`

**Manual assignment (admin):**
1. Admin POSTs `/api/admin/assign` with `orderId` + `artistId`
2. Server validates: artist is active, order not cancelled/done, no duplicate
3. Creates subitem, increments count, auto-approves candidacy (`updateCandidacyConfirmation`)
4. Fires webhook to `ADMIN_CANDIDACY_APPROVED_WEBHOOK_URL`

**Confirmation (admin):**
- `PATCH /api/admin/confirm` handles both candidacy status (`color_mm1q61p2`) and attendance status (`color_mm18bjdk`)
- Approving candidacy also checks for date conflicts: if the same artist is already approved for another order on the same date, approval is blocked
- Fires webhook on approve/reject

**Webhook payload** (sent to `ADMIN_CANDIDACY_APPROVED_WEBHOOK_URL`):
```ts
{
  event: "candidacy_approved" | "candidacy_rejected",
  decidedAt: string,        // ISO timestamp
  admin: { id, name },
  order: AdminOrderDto,
  registration: AdminOrderSubitem,
  artist: { id, name, statusText } | null,
}
```

### Styling

Tailwind CSS with custom component classes in `src/app/globals.css`:
- `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-success`
- `.card` — white rounded-xl card with border and shadow
- `.input-field` — styled form input

Status color convention: blue = registered/active, green = available/approved, orange = almost full/pending, red = full/rejected.

All UI text is Hebrew. `HEBREW_MONTHS` array for date display is duplicated across client files — update all occurrences when editing date logic.

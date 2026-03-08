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

Copy `.env.local.example` to `.env.local`. Two required variables:
- `MONDAY_API_TOKEN` — Monday.com API token (from Profile → Developers → API)
- `JWT_SECRET` — Random string for signing session cookies

## Architecture

This is a **Next.js 15 App Router** app (Hebrew/RTL) for managing artist registrations for events. The backend is entirely **Monday.com** — there is no database. All data is read from and written to Monday.com boards via GraphQL.

### Data Layer (`src/lib/monday.ts`)

All Monday.com interaction lives here. Key constants:

```ts
BOARDS = {
  ARTISTS: 5092847546,   // Login source — artist names/credentials
  ORDERS:  5092847547,   // Event orders
  SUBITEMS: 5092847598,  // Registrations (subitems of orders)
}
```

Column IDs are hardcoded strings (e.g. `"color_mm18ej76"` for order status). When an order fills up, `updateOrderStatus()` is called to flip the status label to `"הסתיים השיבוץ"`.

### Auth (`src/lib/auth.ts` + `src/middleware.ts`)

- Login validates credentials against the Artists board in Monday.com
- On success, a **JWT** (HS256, 7-day expiry) is set as an HttpOnly cookie named `session`
- `SessionUser` shape: `{ id, name, role }` where role is `"אומן"` (artist) or `"מנהל"` (admin)
- Middleware protects `/orders`, `/my-registrations`, `/admin` — redirecting to `/` if unauthenticated
- `/admin` requires `role === "מנהל"`; artists accessing it are redirected to `/orders`

### Page/Component Pattern

Each page follows this split:
- `page.tsx` — Server component: reads session via `getSession()`, enforces auth, passes user to client
- `*Client.tsx` — Client component: all UI state, data fetching via `fetch()` to API routes

### API Routes (`src/app/api/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth` | POST/DELETE | Login / Logout |
| `/api/orders` | GET | Fetch open orders (status = "בתהליך שיבוץ") |
| `/api/register` | POST/DELETE | Register / Unregister artist for an order |
| `/api/my-registrations` | GET | Artist's own registrations |
| `/api/admin/orders` | GET | All orders with subitems (admin only) |
| `/api/admin/confirm` | PATCH | Confirm/reject an attendance record |

### Registration Flow

1. Artist registers → `createSubitem()` (2 mutations: create + set board_relation)
2. `updateAssignedCount()` increments the numeric column
3. If `assignedCount >= requiredCount` → `updateOrderStatus("הסתיים השיבוץ")`
4. Admin confirms via `updateAttendanceConfirmation()` on the subitem

### Styling

Tailwind CSS with custom component classes defined in `src/app/globals.css`:
- `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-success`
- `.card` — white rounded-xl card with border and shadow
- `.input-field` — styled form input

Status color convention: blue = registered/active, green = available/approved, orange = almost full/pending, red = full/rejected.

All UI text is Hebrew. `HEBREW_MONTHS` array for date display is duplicated across client files — if editing date logic, update all occurrences.

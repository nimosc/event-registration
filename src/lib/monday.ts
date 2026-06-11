const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

export const BOARDS = {
  ARTISTS: 5092847546,
  ORDERS: 5092847547,
  SUBITEMS: 5092847598,
  ISSUE_REPORTS: 5094343821,
  INVOICES: 5097191457,
} as const;

export const INVOICE_ARTIST_RELATION_COLUMN_ID = "board_relation_mm3pxdzs";
export const INVOICE_ORDER_RELATION_COLUMN_ID = "board_relation_mm3pnfdw";
export const ARTIST_BANK_DETAILS_COLUMN_ID = "text_mm3pcn99";
export const ARTIST_BANK_CODE_COLUMN_ID = "text_mm3sxtzz";
export const ARTIST_BANK_BRANCH_COLUMN_ID = "text_mm3s1x5x";
export const ARTIST_BANK_ACCOUNT_COLUMN_ID = "text_mm3syq5v";
export const ARTIST_BANK_BENEFICIARY_COLUMN_ID = "text_mm3swn9p";
export const INVOICE_BANK_CODE_COLUMN_ID = "text_mm3se4jy";
export const INVOICE_BANK_BRANCH_COLUMN_ID = "text_mm3sehzc";
export const INVOICE_BANK_ACCOUNT_COLUMN_ID = "text_mm3sm92r";
export const INVOICE_BANK_BENEFICIARY_COLUMN_ID = "text_mm3s6je5";
// Invoice board columns
export const INVOICE_AMOUNT_EXPECTED_COLUMN_ID = "numbernt648wfm";   // סכום שאמור להיות (system)
export const INVOICE_AMOUNT_EXTRACTED_COLUMN_ID = "numeric_mm3pvh20"; // סכום שחולץ מהקובץ (AI, server-side)
export const INVOICE_AMOUNT_REPORTED_COLUMN_ID = "numeric_mm3ph0nj";  // סכום שהלקוח שלח מהטופס
export const INVOICE_NUMBER_COLUMN_ID = "text_mm3p1e0e";             // מספר חשבונית
export const INVOICE_DESCRIPTION_COLUMN_ID = "text_17";              // תיאור של החשבונית
export const INVOICE_AMOUNT_NOTE_COLUMN_ID = "text_mm3p6pma";        // הערות על החשבונית
export const INVOICE_ORDER_IDS_COLUMN_ID = "text_mm3ptnez";          // order IDs as JSON (for duplicate check)
export const SUBITEM_INVOICE_RELATION_COLUMN_ID = "board_relation_mm3shx2f"; // subitem <-> invoice bidirectional relation
export const INVOICE_ACCOUNTING_FILE_COLUMN_ID = "file_mm3s4kna";    // מסמך חשבונאי (קבלה / חשבונית מס קבלה)
export const INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID = "file_mm46at55"; // בקשת תשלום
export const INVOICE_SUBMISSION_STATUS_COLUMN_ID = "color_mm4699gb"; // סטטוס הגשה

export interface MondayColumnValue {
  id: string;
  text: string;
  value: string | null;
  linked_item_ids?: Array<number | string>;
}

/** GraphQL fields for column_values — includes board-relation linked_item_ids (value is often null). */
export const MONDAY_COLUMN_VALUE_FIELDS = `
  id
  text
  value
  ... on BoardRelationValue {
    linked_item_ids
  }
`;

export interface MondaySubitem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

export interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
  subitems?: MondaySubitem[];
}

export interface MondayBoard {
  items_page: {
    cursor?: string | null;
    items: MondayItem[];
  };
}

export interface MondayResponse<T> {
  data: T;
  errors?: { message: string }[];
}

export async function mondayQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN environment variable is not set");
  }

  const body = variables ? { query, variables } : { query };
  const queryPreview = query.trim().slice(0, 80).replace(/\s+/g, " ");
  const start = Date.now();
  console.log(`[Monday] → ${queryPreview}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MONDAY_API_TOKEN.startsWith("Bearer ") ? MONDAY_API_TOKEN : `Bearer ${MONDAY_API_TOKEN}`,
        "API-Version": "2024-01",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    if ((err as Error).name === "AbortError") {
      console.error(`[Monday] ✗ TIMEOUT after ${elapsed}ms — ${queryPreview}`);
      throw new Error(`Monday.com API timeout after ${elapsed}ms`);
    }
    console.error(`[Monday] ✗ fetch error after ${elapsed}ms:`, err);
    throw err;
  }
  clearTimeout(timeout);

  const elapsed = Date.now() - start;
  console.log(`[Monday] ← ${response.status} in ${elapsed}ms`);

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Monday] ✗ HTTP ${response.status}: ${text.slice(0, 200)}`);
    throw new Error(`Monday.com API error: ${response.status} - ${text}`);
  }

  const json = (await response.json()) as MondayResponse<T>;

  if (json.errors && json.errors.length > 0) {
    console.error(`[Monday] ✗ GraphQL errors:`, json.errors);
    throw new Error(
      `Monday.com GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data;
}

export function getColumnValue(
  item: MondayItem | MondaySubitem,
  columnId: string
): MondayColumnValue | undefined {
  return item.column_values.find((cv) => cv.id === columnId);
}

export function parseColorLabel(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return parsed.label || "";
  } catch {
    return "";
  }
}

/**
 * Monday dropdown values often come back as JSON in `value` (while `text` can be empty).
 * We try a few common shapes and return the first label we can find.
 */
export function parseDropdownLabel(value: string | null | undefined): string {
  if (!value) return "";
  try {
    let parsed: any = JSON.parse(value);
    // Some columns are double-stringified on the way in (we do that in updateArtistLocation).
    if (typeof parsed === "string") parsed = JSON.parse(parsed);

    if (parsed?.labels && Array.isArray(parsed.labels) && parsed.labels[0]) {
      return String(parsed.labels[0]);
    }

    const chosen = parsed?.chosenValues ?? parsed?.chosen_values;
    if (Array.isArray(chosen) && chosen.length > 0) {
      const first = chosen[0];
      if (first?.name) return String(first.name);
      if (first?.label) return String(first.label);
    }

    if (typeof parsed?.label === "string") return parsed.label;
  } catch {
    // ignore
  }

  return "";
}

// Monday attendance column values (observed from board) are:
//   "הגיע" / "לא הגיע"
// The UI in this app uses:
//   "מאושר" / "נדחה"
export function mapMondayAttendanceToInternal(
  value: string | null | undefined
): string {
  const t = (value ?? "").trim();
  if (!t) return "";
  if (t === "הגיע") return "מאושר";
  if (t === "לא הגיע") return "נדחה";
  return t; // passthrough for already-normalized values
}

export function mapInternalAttendanceToMonday(value: string): string {
  if (!value) return "";
  if (value === "מאושר") return "הגיע";
  if (value === "נדחה") return "לא הגיע";
  return value;
}

// Monday candidacy status column (admin "אישור מועמדות")
// Observed labels:
//   "מועמדות אושרה" / "מועמדות נדחתה"
export const CANDIDACY_STATUS_COLUMN_ID = "color_mm1q61p2";

export function mapMondayCandidacyToInternal(
  value: string | null | undefined
): string {
  const t = (value ?? "").trim();
  if (!t) return "";
  if (t === "מועמדות אושרה" || t === "מאושר" || t === "אושר") return "מאושר";
  if (t === "מועמדות נדחתה" || t === "נדחה") return "נדחה";
  // Historical boards sometimes return free-text labels. Normalize common patterns.
  if (t.includes("אושר")) return "מאושר";
  if (t.includes("נדח")) return "נדחה";
  if (t.includes("הגיש") || t.includes("מועמד")) return "";
  return t; // passthrough for already-normalized values
}

export function mapInternalCandidacyToMonday(value: string): string {
  if (!value) return "";
  if (value === "מאושר") return "מועמדות אושרה";
  if (value === "נדחה") return "מועמדות נדחתה";
  return value;
}

function parseMaybeJsonDouble(input: string): unknown | null {
  try {
    const first = JSON.parse(input);
    if (typeof first === "string") return JSON.parse(first);
    return first;
  } catch {
    return null;
  }
}

function collectStringsByKeys(obj: unknown, keys: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (keys.has(k) && typeof val === "string" && val.trim()) {
          if (!seen.has(val)) {
            seen.add(val);
            out.push(val);
          }
        } else {
          visit(val);
        }
      }
    }
  };

  visit(obj);
  return out;
}

async function getDropdownOptionsInternal(boardId: number, columnId: string): Promise<string[]> {
  // Primary: use `settings_str` (contains all dropdown options).
  try {
    const query = `
      query {
        boards(ids: [${boardId}]) {
          columns {
            id
            settings_str
          }
        }
      }
    `;

    const data = await mondayQuery<{
      boards: { columns: { id: string; settings_str: string | null }[] }[];
    }>(query);

    const col = data.boards?.[0]?.columns?.find((c) => c.id === columnId);
    const settingsStr = col?.settings_str;
    if (settingsStr) {
      const settings = parseMaybeJsonDouble(settingsStr);
      if (settings && typeof settings === "object") {
        const settingsAny = settings as any;

        const normalizeEntry = (entry: unknown): string | null => {
          if (!entry) return null;
          if (typeof entry === "string") return entry.trim() || null;
          if (typeof entry === "object") {
            const maybeObj = entry as Record<string, unknown>;
            const v = (maybeObj.label ?? maybeObj.name ?? maybeObj.value ?? maybeObj.text) as unknown;
            if (typeof v === "string") return v.trim() || null;
          }
          return null;
        };

        const candidates: string[] = [];

        const directOptions = settingsAny.options;
        if (Array.isArray(directOptions) && directOptions.length > 0) {
          for (const o of directOptions) {
            const v = normalizeEntry(o);
            if (v) candidates.push(v);
          }
        }

        const directLabels = settingsAny.labels;
        if (Array.isArray(directLabels) && directLabels.length > 0) {
          for (const l of directLabels) {
            const v = normalizeEntry(l);
            if (v) candidates.push(v);
          }
        } else if (directLabels && typeof directLabels === "object") {
          for (const v of Object.values(directLabels)) {
            if (Array.isArray(v)) {
              for (const l of v) {
                const norm = normalizeEntry(l);
                if (norm) candidates.push(norm);
              }
            } else {
              const norm = normalizeEntry(v);
              if (norm) candidates.push(norm);
            }
          }
        }

        if (candidates.length === 0) {
          candidates.push(
            ...collectStringsByKeys(settings, new Set(["label", "name", "value", "text"]))
          );
        }

        const deduped = Array.from(new Set(candidates.map((s) => s.trim()).filter(Boolean)));
        const hebrewOnly = deduped.filter((s) => /[\u0590-\u05FF]/.test(s));
        const result = (hebrewOnly.length > 0 ? hebrewOnly : deduped).sort((a, b) => a.localeCompare(b, "he"));
        if (result.length > 0) return result;
      }
    }
  } catch {
    // ignore and fall back
  }

  // Fallback: read actual column values from items we see.
  const fallbackQuery = `
    query {
      boards(ids: [${boardId}]) {
        items_page(limit: 500) {
          items {
            column_values(ids: ["${columnId}"]) {
              text
              value
            }
          }
        }
      }
    }
  `;

  const fallbackData = await mondayQuery<{
    boards: {
      items_page: {
        items: {
          column_values: { text: string; value: string | null }[];
        }[];
      };
    }[];
  }>(fallbackQuery);

  const items = fallbackData.boards?.[0]?.items_page?.items ?? [];
  const labels = new Set<string>();

  for (const item of items) {
    const cv = item.column_values?.[0];
    const label = cv?.text?.trim() || parseDropdownLabel(cv?.value)?.trim() || "";
    if (label) labels.add(label);
  }

  const result = Array.from(labels).map((s) => s.trim()).filter(Boolean);
  result.sort((a, b) => a.localeCompare(b, "he"));
  return result;
}

export async function getArtistLocationOptions(): Promise<string[]> {
  return getDropdownOptionsInternal(BOARDS.ARTISTS, ARTIST_LOCATION_COLUMN_ID);
}

export async function getArtistByIdBasic(
  artistId: string
): Promise<{ id: string; name: string; statusText: string } | null> {
  const query = `
    query {
      items(ids: [${artistId}]) {
        id
        name
        board { id }
        column_values(ids: ["${ARTIST_ACTIVE_STATUS_COLUMN_ID}"]) {
          id
          text
          value
        }
      }
    }
  `;

  const data = await mondayQuery<{ items: (MondayItem & { board?: { id: string } })[] }>(query);
  const artist = data.items?.[0] ?? null;
  if (!artist) return null;
  if (artist.board?.id && artist.board.id !== String(BOARDS.ARTISTS)) return null;

  const col = getColumnValue(artist as unknown as MondayItem, ARTIST_ACTIVE_STATUS_COLUMN_ID);
  const statusText = (col?.text || "").trim();
  return { id: artist.id, name: artist.name, statusText };
}

export async function getLiveArtistRole(
  artistId: string
): Promise<"אומן" | "מנהל" | "ODT" | null> {
  const query = `
    query {
      items(ids: [${artistId}]) {
        board { id }
        column_values(ids: ["color_mm18btbr"]) {
          text
        }
      }
    }
  `;
  try {
    const data = await mondayQuery<{ items: { board?: { id: string }; column_values: { text: string }[] }[] }>(query);
    const item = data.items?.[0];
    if (!item || item.board?.id !== String(BOARDS.ARTISTS)) return null;
    const label = (item.column_values?.[0]?.text || "").trim();
    if (label === "מנהל") return "מנהל";
    if (label === "ODT") return "ODT";
    return "אומן";
  } catch {
    return null;
  }
}

export function parseLinkedItemIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as
      | {
          linkedPulseIds?: Array<{ linkedPulseId?: number | string; id?: number | string }>;
          linked_item_ids?: Array<number | string>;
          item_ids?: Array<number | string>;
        }
      | null;
    if (!parsed || typeof parsed !== "object") return [];

    const ids = new Set<number>();

    for (const key of ["linkedPulseIds", "linked_item_ids", "item_ids"] as const) {
      const arr = parsed[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        const raw = typeof entry === "object" && entry !== null
          ? ("linkedPulseId" in entry ? entry.linkedPulseId : "id" in entry ? entry.id : undefined)
          : entry;
        const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }

    return Array.from(ids);
  } catch {
    return [];
  }
}

export function getLinkedItemIdsFromColumn(
  col: Pick<MondayColumnValue, "value" | "linked_item_ids"> | null | undefined
): string[] {
  if (!col) return [];
  if (Array.isArray(col.linked_item_ids) && col.linked_item_ids.length > 0) {
    return col.linked_item_ids.map((id) => String(id));
  }
  return parseLinkedItemIds(col.value).map((id) => String(id));
}

export function getLinkedItemIdsAsNumbers(
  col: Pick<MondayColumnValue, "value" | "linked_item_ids"> | null | undefined
): number[] {
  return getLinkedItemIdsFromColumn(col)
    .map((id) => parseInt(id, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// ─── Query: Get all artists (for login) ───────────────────────────────────────

export const ARTIST_LOCATION_COLUMN_ID = "dropdown_mm1qvq5q";
export const ORDER_LOCATION_COLUMN_ID = "dropdown_mm1qvq5q";
/** שעות פעילות — טקסט על פריט הזמנה */
export const ORDER_ACTIVITY_HOURS_COLUMN_ID = "text_mm2b57xq";
export const ARTIST_ACTIVE_STATUS_COLUMN_ID = "color_mm18wjry";
export const ODT_REQUIRED_COLUMN_ID = "numeric_mm387qc7";
export const ODT_ASSIGNED_COLUMN_ID = "numeric_mm3b6rnr";
export const SUBITEM_ARTIST_TYPE_COLUMN_ID = "color_mm3bjfvg";
export const ARTIST_REQUIRED_COLUMN_ID = "numeric_mm185aw7";
export const ARTIST_ASSIGNED_COLUMN_ID = "numeric_mm18d914";
export const STATUS_OPEN = "בתהליך שיבוץ";
export const STATUS_CANDIDACY_CLOSED = "סגירת קבלת מועמדויות";
export const STATUS_ASSIGNMENT_DONE = "הסתיים השיבוץ";
export const STATUS_CANCELLED = "בוטל";

export type RegistrationRole = "אומן" | "ODT";

export interface RoleCapacityState {
  required: number;
  assigned: number;
  capacityLimit: number;
  isClosed: boolean;
}

export interface OrderCapacityState {
  artist: RoleCapacityState;
  odt: RoleCapacityState;
}

function toCapacityLimit(required: number): number {
  return required > 0 ? Math.ceil(required * 1.5) : 0;
}

export function getRoleCapacityState(required: number, assigned: number): RoleCapacityState {
  const capacityLimit = toCapacityLimit(required);
  return {
    required,
    assigned,
    capacityLimit,
    isClosed: capacityLimit > 0 && assigned >= capacityLimit,
  };
}

export function getOrderCapacityState(
  requiredArtist: number,
  assignedArtist: number,
  requiredOdt: number,
  assignedOdt: number
): OrderCapacityState {
  return {
    artist: getRoleCapacityState(requiredArtist, assignedArtist),
    odt: getRoleCapacityState(requiredOdt, assignedOdt),
  };
}

export function isRegistrationOpenForRole(
  role: RegistrationRole,
  capacity: OrderCapacityState
): boolean {
  const state = role === "ODT" ? capacity.odt : capacity.artist;
  if (state.capacityLimit <= 0) return false;
  return !state.isClosed;
}

export function areAllRelevantRolesAtCapacity(
  capacity: OrderCapacityState
): boolean {
  const artistRelevant = capacity.artist.capacityLimit > 0;
  const odtRelevant = capacity.odt.capacityLimit > 0;
  if (!artistRelevant && !odtRelevant) return false;
  return (
    (!artistRelevant || capacity.artist.isClosed) &&
    (!odtRelevant || capacity.odt.isClosed)
  );
}

export function getCandidacyOrderStatusFromCapacity(
  capacity: OrderCapacityState,
  currentStatus: string
): string {
  if (currentStatus === STATUS_CANCELLED) return STATUS_CANCELLED;
  if (areAllRelevantRolesAtCapacity(capacity)) return STATUS_ASSIGNMENT_DONE;
  return STATUS_OPEN;
}

export async function getAllArtists(extraColumnIds: string[] = []) {
  const baseIds = ["text_mm18xbdq", "text_mm18d6vn", "color_mm18btbr", "color_mm18wjry", ARTIST_LOCATION_COLUMN_ID];
  const allIds = extraColumnIds.length > 0 ? [...new Set([...baseIds, ...extraColumnIds])] : baseIds;
  const columnIds = JSON.stringify(allIds);
  const firstPageQuery = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: ${columnIds}) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ boards: MondayBoard[] }>(firstPageQuery);
  const firstPage = data.boards[0]?.items_page;
  const items: MondayItem[] = [...(firstPage?.items ?? [])];
  let cursor = firstPage?.cursor ?? null;

  while (cursor) {
    const nextPageQuery = `
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items {
            id
            name
            column_values(ids: ${columnIds}) {
              id
              text
              value
            }
          }
        }
      }
    `;
    const nextData = await mondayQuery<{ next_items_page: { cursor?: string | null; items: MondayItem[] } }>(nextPageQuery);
    items.push(...(nextData.next_items_page?.items ?? []));
    cursor = nextData.next_items_page?.cursor ?? null;
  }

  return items;
}

/** Artists board column for tax status: "מורשה" or "פטור" */
export const ARTIST_TAX_STATUS_COLUMN_ID = "color_mm1axnas";

/** Get artist tax status (מורשה / פטור) by artist item id. Used for income calculation. */
export async function getArtistTaxStatus(artistId: number): Promise<"מורשה" | "פטור" | ""> {
  const query = `
    query {
      items(ids: [${artistId}]) {
        column_values(ids: ["${ARTIST_TAX_STATUS_COLUMN_ID}"]) {
          id
          text
        }
      }
    }
  `;
  const data = await mondayQuery<{ items: MondayItem[] }>(query);
  const artist = data.items?.[0];
  if (!artist) return "";
  const col = getColumnValue(artist, ARTIST_TAX_STATUS_COLUMN_ID);
  const label = (col?.text || "").trim();
  if (label === "פטור" || label === "מורשה") return label;
  return "";
}

export async function updateArtistTaxStatus(
  artistId: string,
  taxStatus: "מורשה" | "פטור"
): Promise<void> {
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.ARTISTS},
        item_id: ${artistId},
        column_id: "${ARTIST_TAX_STATUS_COLUMN_ID}",
        value: ${JSON.stringify(JSON.stringify({ label: taxStatus }))}
      ) {
        id
      }
    }
  `;
  await mondayQuery(query);
}

// ─── Query: Get open orders ───────────────────────────────────────────────────

export async function getOpenOrders() {
  const query = `
    query {
      boards(ids: [${BOARDS.ORDERS}]) {
        items_page(limit: 100) {
          items {
            id
            name
            column_values(ids: ["date_mm18mqn2", "color_mm18ej76", "text_mm1894y7", "numeric_mm185aw7", "numeric_mm18d914", "${ODT_REQUIRED_COLUMN_ID}", "${ODT_ASSIGNED_COLUMN_ID}", "${ORDER_LOCATION_COLUMN_ID}", "${ORDER_ACTIVITY_HOURS_COLUMN_ID}"]) {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values(ids: ["board_relation_mm18r4da", "color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}"]) {
                ${MONDAY_COLUMN_VALUE_FIELDS}
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  return data.boards[0]?.items_page?.items ?? [];
}

// ─── Query: Get all orders with subitems (admin) ──────────────────────────────

export async function getAllOrders() {
  const query = `
    query {
      boards(ids: [${BOARDS.ORDERS}]) {
        items_page(limit: 200) {
          items {
            id
            name
            column_values(ids: ["date_mm18mqn2", "color_mm18ej76", "text_mm1894y7", "numeric_mm185aw7", "numeric_mm18d914", "${ODT_REQUIRED_COLUMN_ID}", "${ODT_ASSIGNED_COLUMN_ID}", "${ORDER_ACTIVITY_HOURS_COLUMN_ID}"]) {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values(ids: ["board_relation_mm18r4da", "dropdown_mm18519p", "color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}", "color_mm3bjfvg", "color_mm3pd8vf", "${SUBITEM_INVOICE_RELATION_COLUMN_ID}"]) {
                ${MONDAY_COLUMN_VALUE_FIELDS}
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  return data.boards[0]?.items_page?.items ?? [];
}

export async function getOrdersByIdsForInvoice(orderIds: string[]): Promise<MondayItem[]> {
  const numericIds = orderIds
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (numericIds.length === 0) return [];

  const query = `
    query {
      items(ids: [${numericIds.join(",")}]) {
        id
        name
        column_values(ids: ["date_mm18mqn2"]) {
          id
          text
          value
        }
        subitems {
          id
          name
          column_values(ids: ["board_relation_mm18r4da", "color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}", "color_mm3pd8vf"]) {
            ${MONDAY_COLUMN_VALUE_FIELDS}
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ items: MondayItem[] }>(query);
  return data.items ?? [];
}

/** Admin orders API shape — shared by getAllOrders mapping and getOrderAdminSnapshotById */
export interface AdminOrderSubitem {
  id: string;
  name: string;
  linkedArtistIds: number[];
  role: string;
  artistType: string;
  attendanceStatus: string;
  candidacyStatus: string;
  hasCandidacyDateConflict?: boolean;
  candidacyDateConflictMessage?: string;
}

export interface AdminOrderDto {
  id: string;
  name: string;
  date: string;
  location: string;
  /** שעות פעילות (עמודת טקסט ב-Monday) */
  activityHours: string;
  status: string;
  requiredCount: number;
  requiredOdtCount: number;
  assignedCount: number;
  spotsRemaining: number;
  subitems: AdminOrderSubitem[];
}

function toDateOnlyKey(input: string): string {
  const match = (input || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseMondayDateValue(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { date?: string };
    return typeof parsed?.date === "string" ? parsed.date : "";
  } catch {
    return "";
  }
}

type ApprovedArtistDateEntry = {
  orderId: string;
  orderName: string;
  subitemId: string;
};

function normalizeArtistNameKey(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getSubitemArtistConflictKey(sub: AdminOrderSubitem): string {
  const artistId = sub.linkedArtistIds[0];
  if (artistId) return `id:${artistId}`;
  const nameKey = normalizeArtistNameKey(sub.name);
  if (!nameKey) return "";
  return `name:${nameKey}`;
}

function buildApprovedArtistDateIndex(orders: AdminOrderDto[]): Map<string, ApprovedArtistDateEntry[]> {
  const index = new Map<string, ApprovedArtistDateEntry[]>();
  let approvedWithoutArtistId = 0;
  let approvedWithArtistId = 0;
  for (const order of orders) {
    const dateKey = toDateOnlyKey(order.date);
    if (!dateKey) continue;
    for (const sub of order.subitems) {
      if ((sub.candidacyStatus ?? "") !== "מאושר") continue;
      const artistKey = getSubitemArtistConflictKey(sub);
      if (!artistKey) {
        approvedWithoutArtistId += 1;
        continue;
      }
      approvedWithArtistId += 1;
      const key = `${artistKey}::${dateKey}`;
      const list = index.get(key) ?? [];
      list.push({
        orderId: order.id,
        orderName: order.name,
        subitemId: sub.id,
      });
      index.set(key, list);
    }
  }
  return index;
}

export function withCandidacyDateConflictFlags(orders: AdminOrderDto[]): AdminOrderDto[] {
  const approvedIndex = buildApprovedArtistDateIndex(orders);
  return orders.map((order) => {
    const dateKey = toDateOnlyKey(order.date);
    if (!dateKey) return order;
    return {
      ...order,
      subitems: order.subitems.map((sub) => {
        const artistKey = getSubitemArtistConflictKey(sub);
        if (!artistKey) return sub;
        const key = `${artistKey}::${dateKey}`;
        const approvedOnSameDate = approvedIndex.get(key) ?? [];
        const conflict = approvedOnSameDate.find((entry) => entry.orderId !== order.id);
        if (!conflict) {
          return {
            ...sub,
            hasCandidacyDateConflict: false,
            candidacyDateConflictMessage: "",
          };
        }
        return {
          ...sub,
          hasCandidacyDateConflict: true,
          candidacyDateConflictMessage: "אושר לאירוע באותו תאריך",
        };
      }),
    };
  });
}

function buildArtistTypeMaps(artists: MondayItem[]): {
  byId: Map<string, string>;
  byName: Map<string, string>;
} {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const artist of artists) {
    const roleCol = artist.column_values?.find((cv) => cv.id === "color_mm18btbr");
    const label = (roleCol?.text || "").trim();
    const type = label === "ODT" ? "ODT" : "אומן";
    byId.set(String(artist.id), type);
    const nameKey = (artist.name || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, type);
  }
  return { byId, byName };
}

export async function getAllOrdersWithCandidacyDateConflicts(): Promise<AdminOrderDto[]> {
  const [items, artists] = await Promise.all([getAllOrders(), getAllArtists()]);
  const { byId: artistTypeById, byName: artistTypeByName } = buildArtistTypeMaps(artists);
  const orders = items.map((item) => mapMondayOrderItemToAdminOrder(item));
  const withFlags = withCandidacyDateConflictFlags(orders);
  const withTypes = withFlags.map((order) => ({
    ...order,
    subitems: order.subitems.map((sub) => {
      if (sub.artistType) return sub;
      const byId = sub.linkedArtistIds[0] != null
        ? artistTypeById.get(String(sub.linkedArtistIds[0]))
        : undefined;
      const nameKey = (sub.name || "").trim().replace(/\s+/g, " ").toLowerCase();
      const byName = nameKey ? artistTypeByName.get(nameKey) : undefined;
      return { ...sub, artistType: byId ?? byName ?? "" };
    }),
  }));
  return withTypes;
}

export async function getCandidacyDateConflictForSubitem(
  orderId: string,
  subitemId: string
): Promise<{ hasConflict: boolean; message?: string }> {
  const orders = await getAllOrdersWithCandidacyDateConflicts();
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { hasConflict: false };
  const subitem = order.subitems.find((s) => s.id === subitemId);
  if (!subitem) return { hasConflict: false };
  if (!subitem.hasCandidacyDateConflict) {
    return { hasConflict: false };
  }
  return {
    hasConflict: true,
    message: subitem.candidacyDateConflictMessage || "לא ניתן לאשר - האומן כבר מאושר באירוע אחר באותו תאריך",
  };
}

export function mapMondayOrderItemToAdminOrder(item: MondayItem): AdminOrderDto {
  const dateCol = getColumnValue(item, "date_mm18mqn2");
  const statusCol = getColumnValue(item, "color_mm18ej76");
  const locationCol = getColumnValue(item, "text_mm1894y7");
  const activityHoursCol = getColumnValue(item, ORDER_ACTIVITY_HOURS_COLUMN_ID);
  const requiredCol = getColumnValue(item, "numeric_mm185aw7");
  const requiredOdtCol = getColumnValue(item, ODT_REQUIRED_COLUMN_ID);
  const assignedCol = getColumnValue(item, "numeric_mm18d914");

  const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
  const requiredOdtCount = parseFloat(requiredOdtCol?.text || "0") || 0;
  const assignedCount = parseFloat(assignedCol?.text || "0") || 0;
  const totalRequired = requiredCount + requiredOdtCount;

  const subitems = (item.subitems || []).map((sub) => {
    const relationCol = sub.column_values.find(
      (cv) => cv.id === "board_relation_mm18r4da"
    );
    const roleCol = sub.column_values.find((cv) => cv.id === "dropdown_mm18519p");
    const attendanceCol = sub.column_values.find((cv) => cv.id === "color_mm18bjdk");
    const candidacyCol = sub.column_values.find(
      (cv) => cv.id === CANDIDACY_STATUS_COLUMN_ID
    );
    const artistTypeCol = sub.column_values.find((cv) => cv.id === "color_mm3bjfvg");

    const linkedArtistIds = getLinkedItemIdsAsNumbers(relationCol);
    return {
      id: sub.id,
      name: sub.name,
      linkedArtistIds,
      role: roleCol?.text || "",
      artistType: (artistTypeCol?.text || "").trim(),
      attendanceStatus: mapMondayAttendanceToInternal(attendanceCol?.text || ""),
      candidacyStatus: mapMondayCandidacyToInternal(candidacyCol?.text || ""),
    };
  });

  const isoDate = parseMondayDateValue(dateCol?.value);
  return {
    id: item.id,
    name: item.name,
    date: isoDate || dateCol?.text || "",
    location: locationCol?.text || "",
    activityHours: (activityHoursCol?.text || "").trim(),
    status: statusCol?.text || "",
    requiredCount,
    requiredOdtCount,
    assignedCount,
    spotsRemaining: Math.max(0, totalRequired - assignedCount),
    subitems,
  };
}

const ADMIN_ORDER_ITEM_COLUMNS = `column_values(ids: ["date_mm18mqn2", "color_mm18ej76", "text_mm1894y7", "numeric_mm185aw7", "numeric_mm18d914", "${ODT_REQUIRED_COLUMN_ID}", "${ORDER_ACTIVITY_HOURS_COLUMN_ID}"]) {
          id
          text
          value
        }`;

const ADMIN_ORDER_SUBITEM_COLUMNS = `column_values(ids: ["board_relation_mm18r4da", "dropdown_mm18519p", "color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}", "color_mm3bjfvg"]) {
            id
            text
            value
          }`;

/** One order with the same columns as getAllOrders — for webhooks and post-mutation checks */
export async function getOrderAdminSnapshotById(
  orderId: string
): Promise<AdminOrderDto | null> {
  const query = `
    query {
      items(ids: [${orderId}]) {
        id
        name
        ${ADMIN_ORDER_ITEM_COLUMNS}
        subitems {
          id
          name
          ${ADMIN_ORDER_SUBITEM_COLUMNS}
        }
      }
    }
  `;
  const data = await mondayQuery<{ items: MondayItem[] }>(query);
  const item = data.items?.[0];
  if (!item) return null;
  return mapMondayOrderItemToAdminOrder(item);
}

// ─── Mutation: Update artist location ────────────────────────────────────────

export async function getArtistBankDetails(artistId: string): Promise<string> {
  const details = await getArtistBankDetailsFields(artistId);
  if (details.beneficiaryName || details.bankCode || details.bankBranch || details.bankAccount) {
    return [details.beneficiaryName, details.bankCode, details.bankBranch, details.bankAccount].filter(Boolean).join(" / ");
  }
  return details.legacy;
}

export interface ArtistBankDetails {
  beneficiaryName: string;
  bankCode: string;
  bankBranch: string;
  bankAccount: string;
  legacy: string;
}

export async function getArtistBankDetailsFields(artistId: string): Promise<ArtistBankDetails> {
  const data = await mondayQuery<{ items: { column_values: { id: string; text: string }[] }[] }>(
    `query { items(ids: [${artistId}]) { column_values(ids: ["${ARTIST_BANK_DETAILS_COLUMN_ID}", "${ARTIST_BANK_BENEFICIARY_COLUMN_ID}", "${ARTIST_BANK_CODE_COLUMN_ID}", "${ARTIST_BANK_BRANCH_COLUMN_ID}", "${ARTIST_BANK_ACCOUNT_COLUMN_ID}"]) { id text } } }`
  );
  const columns = data.items?.[0]?.column_values ?? [];
  const byId = new Map(columns.map((col) => [col.id, (col.text || "").trim()]));
  return {
    beneficiaryName: byId.get(ARTIST_BANK_BENEFICIARY_COLUMN_ID) || "",
    bankCode: byId.get(ARTIST_BANK_CODE_COLUMN_ID) || "",
    bankBranch: byId.get(ARTIST_BANK_BRANCH_COLUMN_ID) || "",
    bankAccount: byId.get(ARTIST_BANK_ACCOUNT_COLUMN_ID) || "",
    legacy: byId.get(ARTIST_BANK_DETAILS_COLUMN_ID) || "",
  };
}

export async function updateArtistBankDetails(
  artistId: string,
  bankDetails: string,
  beneficiaryName?: string,
  bankCode?: string,
  bankBranch?: string,
  bankAccount?: string
): Promise<void> {
  const beneficiary = (beneficiaryName || "").trim();
  const code = (bankCode || "").trim();
  const branch = (bankBranch || "").trim();
  const account = (bankAccount || "").trim();
  const legacy = bankDetails.trim() || [beneficiary, code, branch, account].filter(Boolean).join(" / ");

  await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
    }`,
    {
      boardId: String(BOARDS.ARTISTS),
      itemId: String(artistId),
      columnValues: JSON.stringify({
        [ARTIST_BANK_DETAILS_COLUMN_ID]: legacy,
        [ARTIST_BANK_BENEFICIARY_COLUMN_ID]: beneficiary,
        [ARTIST_BANK_CODE_COLUMN_ID]: code,
        [ARTIST_BANK_BRANCH_COLUMN_ID]: branch,
        [ARTIST_BANK_ACCOUNT_COLUMN_ID]: account,
      }),
    }
  );
}

export async function updateArtistLocation(
  artistId: string,
  location: string
): Promise<void> {
  const labelValue = JSON.stringify(JSON.stringify({ labels: [location] }));
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.ARTISTS},
        item_id: ${artistId},
        column_id: "${ARTIST_LOCATION_COLUMN_ID}",
        value: ${labelValue}
      ) {
        id
      }
    }
  `;
  await mondayQuery(query);
}

// ─── Mutation: Create subitem (register artist) ───────────────────────────────

export async function createSubitem(
  orderId: string,
  artistName: string,
  artistId: string,
  artistType?: RegistrationRole
): Promise<{ id: string }> {
  // Step 1: Create the subitem
  const createQuery = `
    mutation {
      create_subitem(
        parent_item_id: ${orderId},
        item_name: "${artistName.replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  const createData = await mondayQuery<{ create_subitem: { id: string } }>(createQuery);
  const subitemId = createData.create_subitem.id;

  // Step 2: Set the board_relation column separately (can't be set during creation)
  const relationValue = JSON.stringify({ item_ids: [parseInt(artistId, 10)] });
  const updateQuery = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.SUBITEMS},
        item_id: ${subitemId},
        column_id: "board_relation_mm18r4da",
        value: ${JSON.stringify(relationValue)}
      ) {
        id
      }
    }
  `;

  await mondayQuery(updateQuery);

  // Step 3: Set registration date
  const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
  const dateValue = JSON.stringify(JSON.stringify({ date: today }));
  const dateQuery = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.SUBITEMS},
        item_id: ${subitemId},
        column_id: "date0",
        value: ${dateValue}
      ) {
        id
      }
    }
  `;

  await mondayQuery(dateQuery);

  if (artistType) {
    const typeQuery = `
      mutation {
        change_column_value(
          board_id: ${BOARDS.SUBITEMS},
          item_id: ${subitemId},
          column_id: "${SUBITEM_ARTIST_TYPE_COLUMN_ID}",
          value: ${JSON.stringify(JSON.stringify({ label: artistType }))}
        ) {
          id
        }
      }
    `;
    await mondayQuery(typeQuery);
  }

  return { id: subitemId };
}

// ─── Mutation: Delete subitem (unregister) ────────────────────────────────────

export async function deleteSubitem(subitemId: string): Promise<{ id: string }> {
  const query = `
    mutation {
      delete_item(item_id: ${subitemId}) {
        id
      }
    }
  `;

  const data = await mondayQuery<{ delete_item: { id: string } }>(query);
  return data.delete_item;
}

// ─── Mutation: Update assigned count ─────────────────────────────────────────

export async function updateAssignedCount(
  orderId: string,
  count: number,
  columnId: string = ARTIST_ASSIGNED_COLUMN_ID
): Promise<void> {
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.ORDERS},
        item_id: ${orderId},
        column_id: "${columnId}",
        value: "${count}"
      ) {
        id
      }
    }
  `;

  await mondayQuery(query);
}

// ─── Mutation: Update order status ───────────────────────────────────────────

export async function updateOrderStatus(
  orderId: string,
  label: string
): Promise<void> {
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.ORDERS},
        item_id: ${orderId},
        column_id: "color_mm18ej76",
        value: ${JSON.stringify(JSON.stringify({ label }))}
      ) {
        id
      }
    }
  `;

  await mondayQuery(query);
}

// ─── Query: Get single order with subitems (for confirm logic) ────────────────

export async function getOrderById(orderId: string) {
  const query = `
    query {
      items(ids: [${orderId}]) {
        id
        column_values(ids: ["color_mm18ej76", "numeric_mm185aw7"]) {
          id
          text
        }
        subitems {
          id
          column_values(ids: ["color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}"]) {
            id
            text
          }
        }
      }
    }
  `;
  const data = await mondayQuery<{ items: MondayItem[] }>(query);
  return data.items?.[0] ?? null;
}

// ─── Mutation: Update attendance confirmation ─────────────────────────────────

export async function updateAttendanceConfirmation(
  subitemId: string,
  label: string
): Promise<void> {
  const mondayLabel = mapInternalAttendanceToMonday(label);
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.SUBITEMS},
        item_id: ${subitemId},
        column_id: "color_mm18bjdk",
        value: ${JSON.stringify(JSON.stringify({ label: mondayLabel }))}
      ) {
        id
      }
    }
  `;

  await mondayQuery(query);
}

// ─── Mutation: Update candidacy confirmation ────────────────────────────────
export async function updateCandidacyConfirmation(
  subitemId: string,
  label: string
): Promise<void> {
  const mondayLabel = mapInternalCandidacyToMonday(label);
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.SUBITEMS},
        item_id: ${subitemId},
        column_id: "${CANDIDACY_STATUS_COLUMN_ID}",
        value: ${JSON.stringify(JSON.stringify({ label: mondayLabel }))}
      ) {
        id
      }
    }
  `;

  await mondayQuery(query);
}

export interface IssueReportInput {
  title: string;
  description: string;
  reporterName: string;
  reporterRole: "אומן" | "מנהל" | "ODT";
  path?: string;
}

export async function createIssueReport(input: IssueReportInput): Promise<{ itemId: string }> {
  const title = input.title.trim();
  const description = input.description.trim();
  const location = (input.path || "").trim() || "לא צוין";
  const now = new Date().toLocaleString("he-IL", { hour12: false });

  const createItemMutation = `
    mutation ($boardId: ID!, $itemName: String!) {
      create_item(board_id: $boardId, item_name: $itemName) {
        id
      }
    }
  `;

  const createItemData = await mondayQuery<{ create_item: { id: string } }>(
    createItemMutation,
    {
      boardId: BOARDS.ISSUE_REPORTS,
      itemName: title,
    }
  );

  const itemId = createItemData.create_item.id;
  const updateBody = [
    `תיאור התקלה:`,
    description,
    "",
    `דווח על ידי: ${input.reporterName} (${input.reporterRole})`,
    `עמוד: ${location}`,
    `תאריך דיווח: ${now}`,
  ].join("\n");

  const createUpdateMutation = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  await mondayQuery(createUpdateMutation, {
    itemId,
    body: updateBody,
  });

  return { itemId };
}

// ─── Invoices board ───────────────────────────────────────────────────────────

/** YYYY-MM → MM/YYYY (Monday group title) */
export function monthKeyToInvoiceGroupTitle(monthKey: string): string | null {
  const match = monthKey.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return `${match[2]}/${match[1]}`;
}

/** Event date YYYY-MM-DD → MM/YYYY */
export function eventDateToInvoiceGroupTitle(eventDate: string): string | null {
  const match = eventDate.trim().match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[2]}/${match[1]}`;
}

export function resolveInvoiceGroupTitle(monthKey: string, eventDate: string): string {
  return (
    monthKeyToInvoiceGroupTitle(monthKey) ??
    eventDateToInvoiceGroupTitle(eventDate) ??
    monthKeyToInvoiceGroupTitle(getCurrentMonthKey())!
  );
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function ensureInvoiceMonthGroup(
  boardId: number,
  groupTitle: string
): Promise<string> {
  const boardsData = await mondayQuery<{
    boards: Array<{ groups: Array<{ id: string; title: string }> }>;
  }>(
    `query ($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        groups { id title }
      }
    }`,
    { boardIds: [String(boardId)] }
  );

  const groups = boardsData.boards[0]?.groups ?? [];
  const existing = groups.find((g) => g.title.trim() === groupTitle);
  if (existing) return existing.id;

  const created = await mondayQuery<{ create_group: { id: string } }>(
    `mutation ($boardId: ID!, $groupName: String!) {
      create_group(board_id: $boardId, group_name: $groupName) { id }
    }`,
    { boardId: String(boardId), groupName: groupTitle }
  );

  return created.create_group.id;
}

export interface InvoiceItemDto {
  id: string;
  name: string;
  status: string;
  date: string;
  amount: number;       // expected (system calculated)
  actualAmount: number; // backward-compat: reported amount (client form)
  extractedAmount: number; // AI extracted amount
  reportedAmount: number; // client-submitted amount
  invoiceNumber: string;
  bankDetails: string;
  beneficiaryName: string;
  bankCode: string;
  bankBranch: string;
  bankAccount: string;
  amountNote: string;
  description: string;
  orderIds: string[];
  submissionStatus: string;
}

export async function createInvoiceItem(params: {
  artistId: string;
  artistName: string;
  orderIds: string[];
  amount: number;          // expected amount (system calculated)
  actualAmount?: number;   // amount sent from client form (reported)
  extractedAmount?: number; // amount extracted from invoice file (AI/server)
  invoiceNumber: string;   // invoice/receipt number (AI extracted)
  bankDetails: string;
  beneficiaryName: string;
  bankCode: string;
  bankBranch: string;
  bankAccount: string;
  amountNote: string;      // explanation if amount differs
  description: string;     // invoice description / details
  eventDate: string;
  monthLabel: string;
  monthKey: string;
  submissionStatus?: string;
}): Promise<{ id: string }> {
  const itemName = `חשבונית - ${params.monthLabel} - ${params.artistName}`;
  const groupTitle = resolveInvoiceGroupTitle(params.monthKey, params.eventDate);
  const groupId = await ensureInvoiceMonthGroup(BOARDS.INVOICES, groupTitle);

  const colValues: Record<string, unknown> = {};
  const invoiceDate =
    monthKeyToInvoiceGroupTitle(params.monthKey) != null
      ? `${params.monthKey.trim()}-01`
      : params.eventDate;
  if (invoiceDate) colValues["date"] = { date: invoiceDate };
  if (params.amount) colValues[INVOICE_AMOUNT_EXPECTED_COLUMN_ID] = params.amount;
  if (params.extractedAmount != null) colValues[INVOICE_AMOUNT_EXTRACTED_COLUMN_ID] = params.extractedAmount;
  const reportedAmountToSave = params.actualAmount ?? params.amount;
  if (reportedAmountToSave != null) {
    colValues[INVOICE_AMOUNT_REPORTED_COLUMN_ID] = reportedAmountToSave;
  }
  if (params.invoiceNumber) colValues[INVOICE_NUMBER_COLUMN_ID] = params.invoiceNumber;
  if (params.bankDetails) colValues["text9"] = params.bankDetails;
  if (params.beneficiaryName) colValues[INVOICE_BANK_BENEFICIARY_COLUMN_ID] = params.beneficiaryName;
  if (params.bankCode) colValues[INVOICE_BANK_CODE_COLUMN_ID] = params.bankCode;
  if (params.bankBranch) colValues[INVOICE_BANK_BRANCH_COLUMN_ID] = params.bankBranch;
  if (params.bankAccount) colValues[INVOICE_BANK_ACCOUNT_COLUMN_ID] = params.bankAccount;
  if (params.amountNote) colValues[INVOICE_AMOUNT_NOTE_COLUMN_ID] = params.amountNote;
  if (params.description) colValues[INVOICE_DESCRIPTION_COLUMN_ID] = params.description;
  if (params.submissionStatus) {
    colValues[INVOICE_SUBMISSION_STATUS_COLUMN_ID] = { label: params.submissionStatus };
  }
  colValues[INVOICE_ORDER_IDS_COLUMN_ID] = JSON.stringify(params.orderIds);

  const createData = await mondayQuery<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $colValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $colValues
      ) { id }
    }`,
    {
      boardId: String(BOARDS.INVOICES),
      groupId,
      itemName,
      colValues: JSON.stringify(colValues),
    }
  );

  const invoiceId = createData.create_item.id;

  await mondayQuery(
    `mutation {
      change_column_value(
        board_id: ${BOARDS.INVOICES}, item_id: ${invoiceId},
        column_id: "${INVOICE_ARTIST_RELATION_COLUMN_ID}",
        value: ${JSON.stringify(JSON.stringify({ item_ids: [parseInt(params.artistId, 10)] }))}
      ) { id }
    }`
  );

  if (params.orderIds.length > 0) {
    await mondayQuery(
      `mutation {
        change_column_value(
          board_id: ${BOARDS.INVOICES}, item_id: ${invoiceId},
          column_id: "${INVOICE_ORDER_RELATION_COLUMN_ID}",
          value: ${JSON.stringify(JSON.stringify({ item_ids: params.orderIds.map(Number) }))}
        ) { id }
      }`
    );
  }

  return { id: invoiceId };
}

export async function uploadFileToInvoiceColumn(
  itemId: string,
  columnId: string,
  file: Blob,
  filename: string
): Promise<void> {
  if (!MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  const mutation = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;

  const formData = new FormData();
  formData.append("query", mutation);
  formData.append("variables[file]", file, filename);

  const response = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: { Authorization: `Bearer ${MONDAY_API_TOKEN}` },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Monday file upload error: ${response.status} - ${text.slice(0, 200)}`);
  }

  const json = await response.json() as { errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Monday file upload: ${json.errors[0].message}`);
}

export async function uploadFileToInvoiceItem(itemId: string, file: Blob, filename: string): Promise<void> {
  await uploadFileToInvoiceColumn(itemId, INVOICE_ACCOUNTING_FILE_COLUMN_ID, file, filename);
}

export async function updateInvoiceAccountingDetails(
  invoiceItemId: string,
  params: { invoiceNumber?: string; extractedAmount?: number }
): Promise<void> {
  const columnValues: Record<string, string | number> = {};
  if (params.invoiceNumber?.trim()) {
    columnValues[INVOICE_NUMBER_COLUMN_ID] = params.invoiceNumber.trim();
  }
  if (params.extractedAmount != null) {
    columnValues[INVOICE_AMOUNT_EXTRACTED_COLUMN_ID] = params.extractedAmount;
  }
  if (Object.keys(columnValues).length === 0) return;

  await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
    }`,
    {
      boardId: String(BOARDS.INVOICES),
      itemId: String(invoiceItemId),
      columnValues: JSON.stringify(columnValues),
    }
  );
}

export async function updateInvoiceSubmissionStatus(
  invoiceItemId: string,
  submissionStatus: string
): Promise<void> {
  await mondayQuery(
    `mutation {
      change_column_value(
        board_id: ${BOARDS.INVOICES},
        item_id: ${invoiceItemId},
        column_id: "${INVOICE_SUBMISSION_STATUS_COLUMN_ID}",
        value: ${JSON.stringify(JSON.stringify({ label: submissionStatus }))}
      ) { id }
    }`
  );
}

function mapMondayItemToInvoiceDto(item: MondayItem): InvoiceItemDto {
  const dateCol = getColumnValue(item, "date");
  const expectedAmountCol = getColumnValue(item, INVOICE_AMOUNT_EXPECTED_COLUMN_ID);
  const extractedAmountCol = getColumnValue(item, INVOICE_AMOUNT_EXTRACTED_COLUMN_ID);
  const reportedAmountCol = getColumnValue(item, INVOICE_AMOUNT_REPORTED_COLUMN_ID);
  const orderCol = getColumnValue(item, INVOICE_ORDER_RELATION_COLUMN_ID);

  return {
    id: item.id,
    name: item.name,
    status: getColumnValue(item, "status8")?.text || "",
    date: parseMondayDateValue(dateCol?.value) || dateCol?.text || "",
    amount: parseFloat(expectedAmountCol?.text || "0") || 0,
    actualAmount: parseFloat(reportedAmountCol?.text || "0") || 0,
    extractedAmount: parseFloat(extractedAmountCol?.text || "0") || 0,
    reportedAmount: parseFloat(reportedAmountCol?.text || "0") || 0,
    invoiceNumber: getColumnValue(item, INVOICE_NUMBER_COLUMN_ID)?.text || "",
    bankDetails: getColumnValue(item, "text9")?.text || "",
    beneficiaryName: getColumnValue(item, INVOICE_BANK_BENEFICIARY_COLUMN_ID)?.text || "",
    bankCode: getColumnValue(item, INVOICE_BANK_CODE_COLUMN_ID)?.text || "",
    bankBranch: getColumnValue(item, INVOICE_BANK_BRANCH_COLUMN_ID)?.text || "",
    bankAccount: getColumnValue(item, INVOICE_BANK_ACCOUNT_COLUMN_ID)?.text || "",
    amountNote: getColumnValue(item, INVOICE_AMOUNT_NOTE_COLUMN_ID)?.text || "",
    description: getColumnValue(item, INVOICE_DESCRIPTION_COLUMN_ID)?.text || "",
    submissionStatus: getColumnValue(item, INVOICE_SUBMISSION_STATUS_COLUMN_ID)?.text || "",
    orderIds: (() => {
      const textCol = getColumnValue(item, INVOICE_ORDER_IDS_COLUMN_ID)?.text || "";
      try {
        const parsed = JSON.parse(textCol) as Array<string | number>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((v) => String(v));
        }
      } catch {
        // ignore and fallback to relation column
      }
      return getLinkedItemIdsFromColumn(orderCol);
    })(),
  };
}

const INVOICE_ITEM_COLUMN_IDS = [
  "status8",
  INVOICE_SUBMISSION_STATUS_COLUMN_ID,
  "date",
  INVOICE_AMOUNT_EXPECTED_COLUMN_ID,
  INVOICE_AMOUNT_EXTRACTED_COLUMN_ID,
  INVOICE_AMOUNT_REPORTED_COLUMN_ID,
  INVOICE_NUMBER_COLUMN_ID,
  "text9",
  INVOICE_BANK_BENEFICIARY_COLUMN_ID,
  INVOICE_BANK_CODE_COLUMN_ID,
  INVOICE_BANK_BRANCH_COLUMN_ID,
  INVOICE_BANK_ACCOUNT_COLUMN_ID,
  INVOICE_AMOUNT_NOTE_COLUMN_ID,
  INVOICE_DESCRIPTION_COLUMN_ID,
  INVOICE_ORDER_IDS_COLUMN_ID,
  INVOICE_ARTIST_RELATION_COLUMN_ID,
  INVOICE_ORDER_RELATION_COLUMN_ID,
].map((id) => `"${id}"`).join(", ");

export async function getInvoiceItemForArtist(
  invoiceItemId: string,
  artistId: string
): Promise<InvoiceItemDto | null> {
  const numericId = parseInt(invoiceItemId, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;

  const query = `
    query {
      items(ids: [${numericId}]) {
        id
        name
        column_values(ids: [${INVOICE_ITEM_COLUMN_IDS}]) {
          ${MONDAY_COLUMN_VALUE_FIELDS}
        }
      }
    }
  `;

  const data = await mondayQuery<{ items: MondayItem[] }>(query);
  const item = data.items?.[0];
  if (!item) return null;

  const artistNum = parseInt(artistId, 10);
  const artistCol = getColumnValue(item, INVOICE_ARTIST_RELATION_COLUMN_ID);
  if (!getLinkedItemIdsAsNumbers(artistCol).includes(artistNum)) return null;

  return mapMondayItemToInvoiceDto(item);
}

export async function getArtistInvoices(artistId: string): Promise<InvoiceItemDto[]> {
  const query = `
    query {
      boards(ids: [${BOARDS.INVOICES}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: [${INVOICE_ITEM_COLUMN_IDS}]) {
              ${MONDAY_COLUMN_VALUE_FIELDS}
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  const items = data.boards[0]?.items_page?.items ?? [];
  const artistNum = parseInt(artistId, 10);

  const mapped = items
    .filter((item) => {
      const col = getColumnValue(item, INVOICE_ARTIST_RELATION_COLUMN_ID);
      return getLinkedItemIdsAsNumbers(col).includes(artistNum);
    })
    .map(mapMondayItemToInvoiceDto);
  return mapped;
}

export const SUBITEM_INVOICE_STATUS_COLUMN_ID = "color_mm3pd8vf";

export async function updateSubitemsInvoiceStatus(
  subitemIds: string[],
  statusLabel: string
): Promise<void> {
  if (!subitemIds.length || !statusLabel.trim()) return;
  await Promise.all(
    subitemIds.map((id) =>
      mondayQuery(
        `mutation {
          change_column_value(
            board_id: ${BOARDS.SUBITEMS},
            item_id: ${id},
            column_id: "${SUBITEM_INVOICE_STATUS_COLUMN_ID}",
            value: ${JSON.stringify(JSON.stringify({ label: statusLabel }))}
          ) { id }
        }`
      )
    )
  );
}

export async function markSubitemsInvoiceSubmitted(subitemIds: string[]): Promise<void> {
  await updateSubitemsInvoiceStatus(subitemIds, "הוגשה");
}

export async function linkSubitemsToInvoice(
  subitemIds: string[],
  invoiceItemId: string
): Promise<void> {
  if (!invoiceItemId || subitemIds.length === 0) return;
  const relationValue = JSON.stringify(JSON.stringify({ item_ids: [parseInt(invoiceItemId, 10)] }));
  await Promise.all(
    subitemIds.map((id) =>
      mondayQuery(
        `mutation {
          change_column_value(
            board_id: ${BOARDS.SUBITEMS},
            item_id: ${id},
            column_id: "${SUBITEM_INVOICE_RELATION_COLUMN_ID}",
            value: ${relationValue}
          ) { id }
        }`
      )
    )
  );
}

export async function getArtistSubitemIdsForOrderIds(
  orderIds: string[],
  artistId: number,
  artistName: string
): Promise<string[]> {
  const orders = await getOrdersByIdsForInvoice(orderIds);
  const subitemIds: string[] = [];
  for (const order of orders) {
    for (const sub of order.subitems || []) {
      const relationCol = sub.column_values.find((cv) => cv.id === "board_relation_mm18r4da");
      const linkedIds = getLinkedItemIdsAsNumbers(relationCol);
      if (linkedIds.includes(artistId) || sub.name.trim() === artistName.trim()) {
        subitemIds.push(sub.id);
      }
    }
  }
  return subitemIds;
}

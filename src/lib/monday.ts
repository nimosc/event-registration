const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

export const BOARDS = {
  ARTISTS: 5092847546,
  ORDERS: 5092847547,
  SUBITEMS: 5092847598,
} as const;

export interface MondayColumnValue {
  id: string;
  text: string;
  value: string | null;
}

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
  if (t === "מועמדות אושרה") return "מאושר";
  if (t === "מועמדות נדחתה") return "נדחה";
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

export function parseLinkedItemIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed.linkedPulseIds && Array.isArray(parsed.linkedPulseIds)) {
      return parsed.linkedPulseIds.map(
        (lp: { linkedPulseId: number }) => lp.linkedPulseId
      );
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Query: Get all artists (for login) ───────────────────────────────────────

export const ARTIST_LOCATION_COLUMN_ID = "dropdown_mm1qvq5q";
export const ORDER_LOCATION_COLUMN_ID = "dropdown_mm1qvq5q";
export const STATUS_OPEN = "בתהליך שיבוץ";
export const STATUS_CANDIDACY_CLOSED = "סגירת קבלת מועמדויות";
export const STATUS_ASSIGNMENT_DONE = "הסתיים השיבוץ";

export async function getAllArtists() {
  const query = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: ["text_mm18xbdq", "text_mm18d6vn", "color_mm18btbr", "color_mm18wjry", "${ARTIST_LOCATION_COLUMN_ID}"]) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  return data.boards[0]?.items_page?.items ?? [];
}

/** Artists board column for tax status: "מורשה" or "פטור" */
export const ARTIST_TAX_STATUS_COLUMN_ID = "color_mm1axnas";

/** Get artist tax status (מורשה / פטור) by artist item id. Used for income calculation. */
export async function getArtistTaxStatus(artistId: number): Promise<"מורשה" | "פטור" | ""> {
  const query = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          items {
            id
            column_values(ids: ["${ARTIST_TAX_STATUS_COLUMN_ID}"]) {
              id
              text
            }
          }
        }
      }
    }
  `;
  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  const items = data.boards[0]?.items_page?.items ?? [];
  const artist = items.find((item) => item.id === String(artistId));
  if (!artist) return "";
  const col = getColumnValue(artist, ARTIST_TAX_STATUS_COLUMN_ID);
  const label = (col?.text || "").trim();
  if (label === "פטור" || label === "מורשה") return label;
  return "";
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
            column_values(ids: ["date_mm18mqn2", "color_mm18ej76", "text_mm1894y7", "numeric_mm185aw7", "numeric_mm18d914", "${ORDER_LOCATION_COLUMN_ID}"]) {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values(ids: ["board_relation_mm18r4da", "color_mm18bjdk"]) {
                id
                text
                value
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
            column_values(ids: ["date_mm18mqn2", "color_mm18ej76", "text_mm1894y7", "numeric_mm185aw7", "numeric_mm18d914"]) {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values(ids: ["board_relation_mm18r4da", "dropdown_mm18519p", "color_mm18bjdk", "${CANDIDACY_STATUS_COLUMN_ID}"]) {
                id
                text
                value
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

// ─── Mutation: Update artist location ────────────────────────────────────────

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
  artistId: string
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
  count: number
): Promise<void> {
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.ORDERS},
        item_id: ${orderId},
        column_id: "numeric_mm18d914",
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

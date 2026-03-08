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

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_API_TOKEN.startsWith("Bearer ") ? MONDAY_API_TOKEN : `Bearer ${MONDAY_API_TOKEN}`,
      "API-Version": "2024-01",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Monday.com API error: ${response.status} - ${text}`);
  }

  const json = (await response.json()) as MondayResponse<T>;

  if (json.errors && json.errors.length > 0) {
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

export async function getAllArtists() {
  const query = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: ["text_mm18xbdq", "text_mm18d6vn", "color_mm18btbr", "color_mm18wjry"]) {
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

// ─── Query: Get open orders ───────────────────────────────────────────────────

export async function getOpenOrders() {
  const query = `
    query {
      boards(ids: [${BOARDS.ORDERS}]) {
        items_page(limit: 100) {
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
              column_values(ids: ["board_relation_mm18r4da", "dropdown_mm18519p", "color_mm18bjdk"]) {
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
  const value = JSON.stringify({ label });

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

// ─── Mutation: Update attendance confirmation ─────────────────────────────────

export async function updateAttendanceConfirmation(
  subitemId: string,
  label: string
): Promise<void> {
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARDS.SUBITEMS},
        item_id: ${subitemId},
        column_id: "color_mm18bjdk",
        value: ${JSON.stringify(JSON.stringify({ label }))}
      ) {
        id
      }
    }
  `;

  await mondayQuery(query);
}

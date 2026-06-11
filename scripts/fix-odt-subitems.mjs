import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const MONDAY_API_URL = "https://api.monday.com/v2";
const TOKEN = process.env.MONDAY_API_TOKEN;
const BOARDS = { ARTISTS: 5092847546, ORDERS: 5092847547, SUBITEMS: 5092847598 };
const SUBITEM_ARTIST_TYPE_COLUMN_ID = "color_mm3bjfvg";
const ARTIST_ROLE_COLUMN_ID = "color_mm18btbr";
const APPLY_FIX = process.argv.includes("--fix");
const GROUP_ONLY = process.argv.find((a) => a.startsWith("--group="))?.split("=")[1];

async function mondayQuery(query, variables) {
  const body = variables ? { query, variables } : { query };
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN.startsWith("Bearer ") ? TOKEN : `Bearer ${TOKEN}`,
      "API-Version": "2024-01",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(", "));
  return json.data;
}

function parseLinkedItemIds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const ids = new Set();
    for (const key of ["linkedPulseIds", "linked_item_ids", "item_ids"]) {
      const arr = parsed[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        const raw = typeof entry === "object" ? entry?.linkedPulseId ?? entry?.id : entry;
        const n = parseInt(String(raw ?? ""), 10);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

async function getBoardGroups(boardId) {
  const data = await mondayQuery(`
    query {
      boards(ids: [${boardId}]) {
        id
        name
        groups { id title }
      }
    }
  `);
  return data.boards[0];
}

async function getAllArtistsOdtMap() {
  const odtById = new Map();
  const odtByName = new Map();
  let cursor = null;
  let page = 0;

  do {
    const query = cursor
      ? `query { next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name column_values(ids: ["${ARTIST_ROLE_COLUMN_ID}"]) { text } } } }`
      : `query { boards(ids: [${BOARDS.ARTISTS}]) { items_page(limit: 500) { cursor items { id name column_values(ids: ["${ARTIST_ROLE_COLUMN_ID}"]) { text } } } } }`;

    const data = await mondayQuery(query);
    const pageData = cursor ? data.next_items_page : data.boards[0].items_page;
    cursor = pageData.cursor;
    for (const item of pageData.items) {
      const role = (item.column_values?.[0]?.text || "").trim();
      if (role === "ODT") {
        odtById.set(String(item.id), item.name);
        const nameKey = item.name.trim().replace(/\s+/g, " ").toLowerCase();
        if (nameKey) odtByName.set(nameKey, item.id);
      }
    }
    page++;
  } while (cursor);

  return { odtById, odtByName };
}

async function getOrdersInGroup(groupId) {
  const items = [];
  let cursor = null;

  do {
    const query = cursor
      ? `query { next_items_page(limit: 100, cursor: "${cursor}") { cursor items { id name group { id title } subitems { id name column_values(ids: ["board_relation_mm18r4da", "${SUBITEM_ARTIST_TYPE_COLUMN_ID}"]) { id text value } } } } }`
      : `query { boards(ids: [${BOARDS.ORDERS}]) { groups(ids: ["${groupId}"]) { items_page(limit: 100) { cursor items { id name group { id title } subitems { id name column_values(ids: ["board_relation_mm18r4da", "${SUBITEM_ARTIST_TYPE_COLUMN_ID}"]) { id text value } } } } } } }`;

    const data = await mondayQuery(query);
    const pageData = cursor
      ? data.next_items_page
      : data.boards[0].groups[0].items_page;
    cursor = pageData.cursor;
    items.push(...pageData.items);
  } while (cursor);

  return items;
}

async function setSubitemArtistType(subitemId, label) {
  await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    {
      boardId: String(BOARDS.SUBITEMS),
      itemId: String(subitemId),
      columnId: SUBITEM_ARTIST_TYPE_COLUMN_ID,
      value: JSON.stringify({ label }),
    }
  );
}

function findMissingOdt(orders, odtById, odtByName) {
  const missing = [];

  for (const order of orders) {
    for (const sub of order.subitems || []) {
      const relationCol = sub.column_values.find((c) => c.id === "board_relation_mm18r4da");
      const typeCol = sub.column_values.find((c) => c.id === SUBITEM_ARTIST_TYPE_COLUMN_ID);
      const currentType = (typeCol?.text || "").trim();

      if (currentType === "ODT") continue;

      const linkedIds = parseLinkedItemIds(relationCol?.value);
      const linkedOdtId = linkedIds.find((id) => odtById.has(String(id)));
      const nameKey = sub.name.trim().replace(/\s+/g, " ").toLowerCase();
      const nameOdtId = nameKey ? odtByName.get(nameKey) : undefined;

      if (linkedOdtId || nameOdtId) {
        missing.push({
          orderId: order.id,
          orderName: order.name,
          groupTitle: order.group?.title || "",
          subitemId: sub.id,
          subitemName: sub.name,
          currentType: currentType || "(ריק)",
          artistId: linkedOdtId || nameOdtId,
        });
      }
    }
  }

  return missing;
}

async function getAllOrdersViaGroups(groups) {
  const byId = new Map();
  for (const group of groups) {
    const items = await getOrdersInGroup(group.id);
    for (const item of items) {
      if (!byId.has(item.id)) {
        byId.set(item.id, { ...item, group: item.group ?? { id: group.id, title: group.title } });
      }
    }
    console.log(`  ${group.title}: ${items.length} orders`);
  }
  return [...byId.values()];
}

async function main() {
  console.log(`Mode: ${APPLY_FIX ? "FIX" : "DRY RUN"}\n`);

  const ordersBoard = await getBoardGroups(BOARDS.ORDERS);
  console.log(`Orders board: ${ordersBoard.name}`);
  console.log("Groups:", ordersBoard.groups.map((g) => g.title).join(", "));

  let orders;
  if (GROUP_ONLY) {
    const group = ordersBoard.groups.find((g) => g.title.trim() === GROUP_ONLY);
    if (!group) throw new Error(`Group not found: ${GROUP_ONLY}`);
    console.log(`\nScanning group "${group.title}" only`);
    orders = await getOrdersInGroup(group.id);
  } else {
    console.log("\nScanning all groups on board:");
    orders = await getAllOrdersViaGroups(ordersBoard.groups);
  }

  console.log(`\nTotal unique orders scanned: ${orders.length}`);

  const { odtById, odtByName } = await getAllArtistsOdtMap();
  console.log(`ODT artists in system: ${odtById.size}`);

  const missing = findMissingOdt(orders, odtById, odtByName);

  if (missing.length === 0) {
    console.log("\nNo missing ODT labels found.");
    return;
  }

  console.log(`\nFound ${missing.length} subitem(s) missing ODT label:\n`);
  for (const m of missing) {
    console.log(`- Order: ${m.orderName} (${m.orderId}) [${m.groupTitle}]`);
    console.log(`  Subitem: ${m.subitemName} (${m.subitemId})`);
    console.log(`  Current type: ${m.currentType} → should be ODT (artist ${m.artistId})`);
    console.log();
  }

  if (!APPLY_FIX) {
    console.log('Run with --fix to apply corrections.');
    return;
  }

  for (const m of missing) {
    await setSubitemArtistType(m.subitemId, "ODT");
    console.log(`Fixed subitem ${m.subitemId} (${m.subitemName})`);
  }

  console.log(`\nDone. Fixed ${missing.length} record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

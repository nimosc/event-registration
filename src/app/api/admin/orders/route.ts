import { NextResponse } from "next/server";
import { getAllOrdersWithCandidacyDateConflicts } from "@/lib/monday";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    if (session.role !== "מנהל") {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const orders = await getAllOrdersWithCandidacyDateConflicts();
    // #region agent log
    fetch("http://127.0.0.1:7442/ingest/30911afa-0e0f-4dec-b9b6-19b34bf7d632", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e21a1" },
      body: JSON.stringify({
        sessionId: "8e21a1",
        runId: "initial",
        hypothesisId: "H4",
        location: "src/app/api/admin/orders/route.ts:GET",
        message: "Returning admin orders payload",
        data: {
          ordersCount: orders.length,
          flaggedSubitemsCount: orders.reduce(
            (sum, o) => sum + o.subitems.filter((s) => s.hasCandidacyDateConflict).length,
            0
          ),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Admin orders fetch error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}

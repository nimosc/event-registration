import { NextResponse } from "next/server";
import { getAllOrdersWithCandidacyDateConflicts } from "@/lib/monday";
import { getSession, isAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    if (!isAdmin(session.role)) {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const orders = await getAllOrdersWithCandidacyDateConflicts();

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Admin orders fetch error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}

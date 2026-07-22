import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInstructorActivityData } from "@/lib/instructorReport";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    if (session.role !== "מנהל") {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const payload = await getInstructorActivityData();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Instructor activity report error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הדוח" },
      { status: 500 }
    );
  }
}

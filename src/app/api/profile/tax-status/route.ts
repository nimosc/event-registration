import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateArtistTaxStatus } from "@/lib/monday";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const { taxStatus } = (await request.json()) as { taxStatus: string };
    if (taxStatus !== "מורשה" && taxStatus !== "פטור") {
      return NextResponse.json({ error: "סוג עוסק לא תקין" }, { status: 400 });
    }

    await updateArtistTaxStatus(session.id, taxStatus);

    return NextResponse.json({ success: true, taxStatus });
  } catch (error) {
    console.error("Update tax status error:", error);
    return NextResponse.json({ error: "שגיאה בעדכון סוג העוסק" }, { status: 500 });
  }
}

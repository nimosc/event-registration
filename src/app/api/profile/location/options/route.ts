import { NextResponse } from "next/server";
import { getArtistLocationOptions } from "@/lib/monday";

export async function GET() {
  try {
    const options = await getArtistLocationOptions();
    return NextResponse.json({ options });
  } catch (error) {
    console.error("Get location options error:", error);
    return NextResponse.json({ options: [], error: "שגיאה בטעינת אפשרויות" }, { status: 500 });
  }
}


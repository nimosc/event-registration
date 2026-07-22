import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import InstructorReportClient from "./InstructorReportClient";

export const dynamic = "force-dynamic";

export default async function InstructorReportPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }
  if (session.role !== "מנהל") {
    redirect("/orders");
  }

  return <InstructorReportClient user={session} />;
}

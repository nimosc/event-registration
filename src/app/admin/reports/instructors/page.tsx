import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/auth";
import InstructorReportClient from "./InstructorReportClient";

export const dynamic = "force-dynamic";

export default async function InstructorReportPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }
  if (!isAdmin(session.role)) {
    redirect("/orders");
  }

  return <InstructorReportClient user={session} />;
}

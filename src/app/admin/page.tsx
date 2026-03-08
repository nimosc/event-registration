import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (session.role !== "מנהל") {
    redirect("/orders");
  }

  return <AdminClient user={session} />;
}

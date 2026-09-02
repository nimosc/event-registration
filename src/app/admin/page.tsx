import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/auth";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (!isAdmin(session.role)) {
    redirect("/orders");
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <AdminClient user={session} />
    </Suspense>
  );
}

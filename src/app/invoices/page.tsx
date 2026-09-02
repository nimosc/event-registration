import { redirect } from "next/navigation";
import { getSession, getRegistrationRole } from "@/lib/auth";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (getRegistrationRole(session.role) === null) {
    redirect("/admin");
  }

  return <InvoicesClient user={session} />;
}

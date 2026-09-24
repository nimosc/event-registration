import { redirect } from "next/navigation";
import { getSession, canRegisterForEvents } from "@/lib/auth";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (!canRegisterForEvents(session.role)) {
    redirect("/admin");
  }

  return <InvoicesClient user={session} />;
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (session.role === "מנהל") {
    redirect("/admin");
  }

  return <InvoicesClient user={session} />;
}

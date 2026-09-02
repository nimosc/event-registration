import { redirect } from "next/navigation";
import { getSession, getRegistrationRole } from "@/lib/auth";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (getRegistrationRole(session.role) === null) {
    redirect("/admin");
  }

  return <OrdersClient user={session} />;
}

import { redirect } from "next/navigation";
import { getSession, canRegisterForEvents } from "@/lib/auth";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (!canRegisterForEvents(session.role)) {
    redirect("/admin");
  }

  return <OrdersClient user={session} />;
}

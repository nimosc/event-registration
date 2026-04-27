import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (session.role === "מנהל") {
    redirect("/admin");
  }

  return <OrdersClient user={session} />;
}

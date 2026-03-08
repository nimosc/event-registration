import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  return <OrdersClient user={session} />;
}

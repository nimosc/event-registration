import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (session) redirect("/orders");
  return <LoginClient />;
}

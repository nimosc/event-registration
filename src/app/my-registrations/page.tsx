import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import MyRegistrationsClient from "./MyRegistrationsClient";

export const dynamic = "force-dynamic";

export default async function MyRegistrationsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  if (session.role === "מנהל") {
    redirect("/admin");
  }

  return <MyRegistrationsClient user={session} />;
}

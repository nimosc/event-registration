import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ID?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session) redirect("/orders");
  return <LoginClient magicId={params.ID} />;
}

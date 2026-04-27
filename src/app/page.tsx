import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ID?: string; inactive?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const isInactive = params.inactive === "1";
  if (session && !isInactive) redirect(session.role === "מנהל" ? "/admin" : "/orders");
  return <LoginClient magicId={params.ID} inactive={isInactive} />;
}

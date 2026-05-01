import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth/session";

export default async function Home() {
  if (await isAuthenticated()) redirect("/dashboard");
  redirect("/login");
}

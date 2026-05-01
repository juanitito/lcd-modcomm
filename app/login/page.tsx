import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  if (await isAuthenticated()) redirect("/dashboard");
  const params = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">LCD ModComm</h1>
          <p className="text-sm text-neutral-600">Connecte-toi pour continuer.</p>
        </div>
        <LoginForm error={params.error} from={params.from} />
      </div>
    </main>
  );
}

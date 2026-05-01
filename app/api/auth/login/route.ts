import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";

const Body = z.object({
  password: z.string().min(1),
  from: z.string().optional(),
});

export async function POST(req: Request) {
  const adminPassword = process.env.AUTH_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: "Auth non configurée" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  if (parsed.password !== adminPassword) {
    // évite le bruteforce trivial (très simple — pas du timing-safe parfait)
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  const session = await getSession();
  session.authenticated = true;
  session.loggedInAt = Date.now();
  await session.save();

  const redirectTo = parsed.from && parsed.from.startsWith("/") ? parsed.from : "/dashboard";
  return NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
}

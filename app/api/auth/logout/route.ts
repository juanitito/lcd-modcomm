import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

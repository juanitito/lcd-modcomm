import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";

export type SessionData = {
  authenticated?: boolean;
  loggedInAt?: number;
};

const SESSION_COOKIE_NAME = "lcd_session";

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return {
    password,
    cookieName: SESSION_COOKIE_NAME,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 jours
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return await getIronSession<SessionData>(cookieStore, sessionOptions());
}

export async function requireAuth(): Promise<IronSession<SessionData>> {
  const session = await getSession();
  if (!session.authenticated) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return session;
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session.authenticated);
}

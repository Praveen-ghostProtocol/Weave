import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth callback for Supabase's PKCE flow (Google sign-in): Supabase
// redirects here with ?code=..., which we trade for a session cookie via
// exchangeCodeForSession. Supabase's own docs example redirects using the
// request's `x-forwarded-host` header with no allowlist — red-team caught
// that this is an open-redirect primitive if that header is ever
// attacker-controlled through Vercel's edge (a known footgun with this
// exact pattern). Weave has one fixed production domain, so there's no
// need to trust any header at all: redirect to a server-configured origin
// instead, falling back to the request's own origin only in local dev.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // In production, redirect only to the server-configured site origin —
      // never a request header. In dev there's no NEXT_PUBLIC_SITE_URL and
      // no meaningful spoofing surface (it's your own localhost), so the
      // request's own origin is fine there.
      if (process.env.NODE_ENV === "development") {
        return NextResponse.redirect(`${origin}/`);
      }
      if (!process.env.NEXT_PUBLIC_SITE_URL) {
        throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
      }
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/`);
    }
  }

  // Guest mode stays fully usable even if sign-in fails — just bounce home
  // with a flag the UI can ignore or surface, never a crash/blank page.
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}

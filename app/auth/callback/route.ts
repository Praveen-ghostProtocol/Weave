import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSiteOrigin } from "@/lib/supabase/siteOrigin";

// OAuth callback for Supabase's PKCE flow (Google sign-in): Supabase
// redirects here with ?code=..., which we trade for a session cookie via
// exchangeCodeForSession. See lib/supabase/siteOrigin.ts for why the
// redirect target is a server-configured origin, never a request header.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${resolveSiteOrigin(origin)}/app`);
    }
  }

  // Guest mode stays fully usable even if sign-in fails — just bounce home
  // with a flag the UI can ignore or surface, never a crash/blank page.
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}

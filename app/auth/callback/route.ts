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
  //
  // resolveSiteOrigin here too, not the raw `origin`. This branch used the
  // request-derived origin, which is exactly the x-forwarded-host value
  // siteOrigin.ts calls an open-redirect primitive — the reasoning was
  // written one function away and then not applied on the failure path. An
  // attacker who can set that header turns a bad ?code= into a 302 to their
  // own site issued by this domain, which launders a phishing link.
  return NextResponse.redirect(`${resolveSiteOrigin(origin)}/?auth_error=1`);
}

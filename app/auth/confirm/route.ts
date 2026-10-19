import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSiteOrigin } from "@/lib/supabase/siteOrigin";

// Magic-link / OTP email confirmation. Supabase's default magic-link email
// link puts the session in a URL fragment, which a server route can't
// read — so per Supabase's own docs
// (https://supabase.com/docs/guides/auth/passwords) this uses the
// token_hash + verifyOtp pattern instead of the code-exchange flow
// /auth/callback uses for OAuth. This requires the Magic Link email
// template to be edited in the Supabase dashboard to link here with
// token_hash/type params instead of the default {{ .ConfirmationURL }} —
// a manual step, not something this route can do by itself.
//
// Deliberately no `next` query param: an earlier version accepted one and
// appended it straight into the redirect target, which code review caught
// as a reintroduced open redirect (e.g. `next=@evil.com` resolves to host
// evil.com via the userinfo@host trick, even with a validated origin).
// Nothing here needs the destination to vary, so the fix is to not accept
// a variable destination at all, not to sanitize one.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${resolveSiteOrigin(origin)}/app`);
    }
  }

  // Guest mode stays fully usable even if sign-in fails — bounce to /login
  // with a flag the UI can ignore or surface, never a crash/blank page.
  return NextResponse.redirect(`${origin}/login?auth_error=1`);
}

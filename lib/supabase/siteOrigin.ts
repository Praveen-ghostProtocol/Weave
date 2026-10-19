// Shared by every auth route handler that redirects after a Supabase
// round trip (OAuth code exchange, magic-link token verification). A
// request's own origin is untrustworthy in production — Next.js's
// x-forwarded-host is an open-redirect primitive on Vercel's edge if it's
// ever attacker-controlled (the reasoning /auth/callback was built on).
// Weave has one fixed production domain, so there's no need to trust any
// header at all: redirect to the server-configured site origin instead,
// falling back to the request's own origin only in local dev (no
// meaningful spoofing surface on your own localhost).
export function resolveSiteOrigin(requestOrigin: string): string {
  if (process.env.NODE_ENV === "development") return requestOrigin;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  }
  return siteUrl;
}

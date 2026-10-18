import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

// Server client for Server Components / Route Handlers. Reads and writes
// the session via Next.js's cookies() API (current @supabase/ssr pattern:
// getAll/setAll, not the deprecated get/set/remove).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, which can't set cookies.
          // Safe to ignore as long as middleware refreshes sessions —
          // this project has no middleware yet, so sessions refresh on
          // the next request that can write cookies (a Route Handler).
        }
      },
    },
  });
}

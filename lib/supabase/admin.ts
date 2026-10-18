import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

// Server-only: this client uses the service-role key and bypasses Row Level
// Security entirely. It must never be imported from client code. The throw
// below makes that a runtime failure, not just a comment someone can miss.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts is server-only (service-role key bypasses RLS) — do not import it from client code."
  );
}

export function createAdminClient() {
  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

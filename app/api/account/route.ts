import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Account deletion. The user id always comes from the server session
// (getUser() revalidates the JWT against Supabase Auth, unlike getSession()
// which just reads the cookie) — never from the request body/client state,
// per SPEC.md's Boundaries. Service-role admin client is required because
// auth.admin.deleteUser is not callable with the anon key.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(user.id);
  // "User not found" means a prior call (e.g. a double-click race) already
  // deleted this account — that's success, not a failure. Otherwise a
  // second request after a successful first one would misleadingly report
  // a 500 for an account that's already gone.
  if (deleteError && deleteError.status !== 404) {
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

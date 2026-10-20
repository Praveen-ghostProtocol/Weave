"use client";

// Small client-side auth hook (same spirit as lib/storage/useGraph.tsx:
// one place that owns load + subscribe for a piece of client state). No
// Context/Provider here — unlike the graph, only app/page.tsx's corner
// affordance needs this, so a plain hook is the whole requirement.
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./client";

export function useSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  function signInWithGoogle() {
    createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  // No signInWithMagicLink here, deliberately. It was removed 2026-10-20
  // along with the login page's email form and /auth/confirm — see
  // app/login/page.tsx's header for why `signInWithOtp` is an unlimited
  // account-minting path into the founder's OpenAI spend.

  function signOut() {
    return createClient().auth.signOut();
  }

  return { user, loading, signInWithGoogle, signOut };
}

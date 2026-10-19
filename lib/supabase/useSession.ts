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

  // Magic-link / OTP email sign-in (no password). Lands on /app via
  // app/auth/confirm/route.ts, not the OAuth /auth/callback route — see
  // that file's comment for why email confirmation needs its own handler.
  function signInWithMagicLink(email: string) {
    return createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
  }

  function signOut() {
    return createClient().auth.signOut();
  }

  return { user, loading, signInWithGoogle, signInWithMagicLink, signOut };
}

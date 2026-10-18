// Server-only env vars (secrets). Import only from server-side code
// (route handlers, server components, lib/supabase/admin.ts). Kept in a
// separate module from lib/env.ts so a client-side import can't reach these
// just by importing "the env file".

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
};

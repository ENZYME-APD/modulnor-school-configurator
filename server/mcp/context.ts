import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../src/cloud/config";

export interface McpContext {
  userId: string;
  email: string;
  /** Runs as the signed-in user, so row-level security applies to every query. */
  db: SupabaseClient;
}

export type ResolveResult =
  | { ok: true; ctx: McpContext }
  | { ok: false; status: number; message: string };

/** Validates the bearer token (a Supabase access token issued by its OAuth server). */
export async function resolveToken(
  token: string | null,
): Promise<ResolveResult> {
  if (!token)
    return {
      ok: false,
      status: 401,
      message: "Sign in to connect: this server needs an access token.",
    };
  const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}`, "x-client-source": "mcp" },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub)
    return {
      ok: false,
      status: 401,
      message:
        "The access token is invalid or has expired. Reconnect to sign in again.",
    };
  return {
    ok: true,
    ctx: {
      userId: claims.sub,
      email: (claims.email as string | undefined) ?? "",
      db,
    },
  };
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

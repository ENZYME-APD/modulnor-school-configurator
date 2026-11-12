// Supabase project for shared (cloud) projects and the MCP connection.
// The publishable key is public by design: row-level security in the database
// decides what a signed-in user can read or change.

export const SUPABASE_URL = "https://chahzwbrymokgfbjjdrk.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_pOe6Ksu_uywLadBRHEwgaw_9UUuMMzq";

export interface ProjectRow {
  id: string;
  name: string;
  layout: unknown;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_email: string | null;
  updated_source: "app" | "mcp" | "undo";
  updated_at: string;
  archived_at: string | null;
}

export interface ChangeRow {
  id: number;
  project_id: string;
  change_id: string;
  version: number;
  summary: string;
  source: "app" | "mcp" | "undo";
  actor_email: string | null;
  undone_by: string | null;
  created_at: string;
}

export interface SaveResult {
  project_id: string;
  version: number;
  change_id: string;
}

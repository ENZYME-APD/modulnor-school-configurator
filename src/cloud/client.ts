import {
  createClient,
  type RealtimeChannel,
  type Session,
} from "@supabase/supabase-js";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type ProjectRow,
  type SaveResult,
} from "./config";
import type { SavedModule } from "../core/layout";

// Browser access to shared projects. Every call runs as the signed-in user;
// row-level security in the database decides what is allowed.

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type ProjectSummary = Pick<
  ProjectRow,
  | "id"
  | "name"
  | "version"
  | "updated_at"
  | "updated_by_email"
  | "updated_source"
> & {
  modules: number;
};

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(
  email: string,
  password: string,
): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function sendMagicLink(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.href.split("#")[0],
    },
  });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, layout, version, updated_at, updated_by_email, updated_source",
    )
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as ProjectRow[]).map(({ layout, ...r }) => ({
    ...r,
    modules: Array.isArray(layout) ? layout.length : 0,
  }));
}

export async function getProject(id: string): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as ProjectRow;
}

export async function createProject(
  name: string,
  layout: SavedModule[],
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, layout })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ProjectRow;
}

/** Saves with optimistic concurrency: fails with a "Conflict…" message if someone saved in between. */
export async function saveProject(
  id: string,
  baseVersion: number,
  layout: SavedModule[],
  summary: string,
): Promise<SaveResult> {
  const { data, error } = await supabase.rpc("save_project", {
    p_project_id: id,
    p_base_version: baseVersion,
    p_layout: layout,
    p_summary: summary,
    p_source: "app",
  });
  if (error) throw new Error(error.message);
  return data as SaveResult;
}

/** Calls onChange whenever the project row changes (Claude, a colleague, or another tab). */
export function watchProject(
  id: string,
  onChange: (row: ProjectRow) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`project-${id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "projects",
        filter: `id=eq.${id}`,
      },
      (payload) => onChange(payload.new as ProjectRow),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

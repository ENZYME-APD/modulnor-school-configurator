import "./cloud.css";
import type { Session } from "@supabase/supabase-js";
import type { ProjectRow } from "./config";
import { parseLayout, type SavedModule } from "../core/layout";
import {
  createProject,
  currentSession,
  getProject,
  listProjects,
  saveProject,
  sendMagicLink,
  signIn,
  signOut,
  supabase,
  watchProject,
} from "./client";

// Current project: where it lives (cloud, a file on this computer, or not
// saved yet), its save state, sign-in, and live changes made by Claude (MCP)
// or colleagues while a cloud project is open. The File menu in the top bar
// calls the public functions at the bottom; the sidebar box shows status only.

export interface CloudHooks {
  /** Current scene layout. */
  getLayout: () => SavedModule[];
  /** Replace the scene with a layout (undoable locally). */
  applyLayout: (modules: SavedModule[], opts: { fit: boolean }) => void;
  /** Save the layout as a file; resolves to the chosen file name, or null if cancelled. */
  saveFile: (suggestedName?: string) => Promise<string | null>;
}

interface OpenProject {
  id: string;
  name: string;
  version: number;
}

let hooks: CloudHooks;
let session: Session | null = null;
let open: OpenProject | null = null;
/** Name of the local file the current layout came from or was saved to. */
let fileName: string | null = null;
let dirty = false;
let applying = false;
let pendingRemote: ProjectRow | null = null;
let unwatch: (() => void) | null = null;

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
}

function who(
  row: Pick<ProjectRow, "updated_by_email" | "updated_source">,
): string {
  const email = row.updated_by_email;
  if (row.updated_source === "mcp")
    return `Claude${email ? ` (for ${email})` : ""}`;
  if (row.updated_source === "undo")
    return `an undo${email ? ` by ${email}` : ""}`;
  return email ?? "someone";
}

// ── Markup ────────────────────────────────────────────────────────────────────

function mount(): void {
  const panel = document.createElement("div");
  panel.id = "cloud-panel";
  panel.className = "cloud-panel";
  panel.innerHTML = `
    <div class="cloud-head">
      <span class="cloud-title">Project</span>
      <span class="cloud-account">
        <span id="cloud-user" class="cloud-user"></span>
        <button id="cloud-signin-btn" class="cloud-link">Sign in</button>
        <button id="cloud-signout-btn" class="cloud-link">Sign out</button>
      </span>
    </div>
    <div id="cloud-name" class="cloud-name"></div>
    <div id="cloud-status" class="cloud-status"></div>
    <div id="cloud-banner" class="cloud-banner" hidden></div>`;
  const sidebar = el("sidebar");
  sidebar.insertBefore(panel, sidebar.firstChild);

  const dialog = document.createElement("dialog");
  dialog.id = "cloud-dialog";
  dialog.className = "cloud-dialog";
  document.body.appendChild(dialog);

  const toast = document.createElement("div");
  toast.id = "cloud-toast";
  toast.className = "cloud-toast";
  toast.hidden = true;
  document.body.appendChild(toast);

  el("cloud-signin-btn").addEventListener("click", () => showSignIn());
  el("cloud-signout-btn").addEventListener("click", async () => {
    if (
      open &&
      dirty &&
      !window.confirm("The cloud project has unsaved changes. Sign out anyway?")
    )
      return;
    await signOut();
  });
}

function render(): void {
  if (!document.getElementById("cloud-panel")) return; // not mounted yet (start-up)
  const signedIn = !!session;
  el("cloud-user").textContent = signedIn ? (session!.user.email ?? "") : "";
  el("cloud-signin-btn").hidden = signedIn;
  el("cloud-signout-btn").hidden = !signedIn;

  let name = "Untitled";
  let where = "Not saved yet";
  if (open) {
    name = open.name;
    where = `Cloud · version ${open.version}`;
  } else if (fileName) {
    name = fileName.replace(/\.json$/i, "");
    where = `File on this computer · ${fileName}`;
  }
  el("cloud-name").textContent = name;
  el("cloud-name").classList.toggle("muted", !open && !fileName);
  el("cloud-status").textContent = dirty ? `${where} · unsaved changes` : where;
  el("cloud-status").classList.toggle("dirty", dirty);
}

function showToast(text: string): void {
  const t = el("cloud-toast");
  t.textContent = text;
  t.hidden = false;
  window.clearTimeout((t as unknown as { _timer?: number })._timer);
  (t as unknown as { _timer?: number })._timer = window.setTimeout(
    () => (t.hidden = true),
    5000,
  );
}

function banner(
  html: string | null,
  actions: { label: string; run: () => void; primary?: boolean }[] = [],
): void {
  const b = el("cloud-banner");
  if (!html) {
    b.hidden = true;
    b.innerHTML = "";
    return;
  }
  b.innerHTML = `<div>${html}</div><div class="cloud-banner-actions"></div>`;
  const row = b.querySelector(".cloud-banner-actions")!;
  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.className = a.primary ? "" : "btn-secondary";
    btn.addEventListener("click", a.run);
    row.appendChild(btn);
  });
  b.hidden = false;
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function dialog(html: string): HTMLDialogElement {
  const d = el<HTMLDialogElement>("cloud-dialog");
  d.innerHTML = `<button class="cloud-close" aria-label="Close" data-close>×</button>${html}`;
  d.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => d.close()),
  );
  if (!d.open) d.showModal();
  return d;
}

function showSignIn(then?: () => void): void {
  const d = dialog(`
    <h3>Sign in</h3>
    <p class="cloud-hint">Cloud projects are shared with the team and with Claude. Use your Enzyme account; ask an admin if you don't have one.</p>
    <form id="cloud-signin-form" class="cloud-form">
      <label>Email<input type="email" name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password"></label>
      <p id="cloud-signin-msg" class="cloud-msg" role="status"></p>
      <div class="cloud-form-actions">
        <button type="submit">Sign in</button>
        <button type="button" id="cloud-magic-btn" class="btn-secondary">Email me a sign-in link</button>
      </div>
    </form>`);
  const form = d.querySelector<HTMLFormElement>("#cloud-signin-form")!;
  const msg = d.querySelector<HTMLParagraphElement>("#cloud-signin-msg")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const password = String(fd.get("password") ?? "");
    if (!password) {
      msg.textContent = "Enter your password, or use the sign-in link.";
      return;
    }
    msg.textContent = "Signing in…";
    const err = await signIn(String(fd.get("email")).trim(), password);
    if (err) msg.textContent = err;
    else {
      d.close();
      then?.();
    }
  });
  d.querySelector("#cloud-magic-btn")!.addEventListener("click", async () => {
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) {
      msg.textContent = "Enter your email first.";
      return;
    }
    msg.textContent = "Sending…";
    const err = await sendMagicLink(email);
    msg.textContent = err ?? `Check ${email} for a sign-in link.`;
  });
}

async function showOpen(): Promise<void> {
  const d = dialog(
    `<h3>Open a cloud project</h3><div id="cloud-list" class="cloud-list"><p class="cloud-hint">Loading…</p></div>`,
  );
  try {
    const rows = await listProjects();
    const listEl = d.querySelector("#cloud-list")!;
    if (rows.length === 0) {
      listEl.innerHTML = `<p class="cloud-hint">No cloud projects yet. Use Save as → New cloud project to put the current layout in the cloud.</p>`;
      return;
    }
    listEl.innerHTML = rows
      .map(
        (
          r,
        ) => `<button class="cloud-item${open?.id === r.id ? " current" : ""}" data-id="${r.id}">
          <span class="cloud-item-name">${esc(r.name)}</span>
          <span class="cloud-item-meta">${r.modules} modules · ${when(r.updated_at)} by ${esc(who(r))}</span>
        </button>`,
      )
      .join("");
    listEl.querySelectorAll<HTMLButtonElement>(".cloud-item").forEach((b) =>
      b.addEventListener("click", async () => {
        if (
          dirty &&
          !window.confirm("Discard unsaved changes and open another project?")
        )
          return;
        d.close();
        await openProject(b.dataset.id!);
      }),
    );
  } catch (e) {
    d.querySelector("#cloud-list")!.innerHTML =
      `<p class="cloud-msg">${esc((e as Error).message)}</p>`;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

function applyRow(row: ProjectRow, fit: boolean): void {
  const { modules, problems } = parseLayout(row.layout);
  applying = true;
  try {
    hooks.applyLayout(modules, { fit });
  } finally {
    applying = false;
  }
  open = { id: row.id, name: row.name, version: row.version };
  fileName = null;
  dirty = false;
  pendingRemote = null;
  banner(null);
  if (problems.length)
    showToast(
      `${problems.length} module(s) in the cloud copy could not be read and were skipped.`,
    );
  render();
}

async function openProject(id: string): Promise<void> {
  try {
    const row = await getProject(id);
    applyRow(row, true);
    follow(row.id);
    rememberCloud(row.id);
  } catch (e) {
    window.alert(`Could not open the project: ${(e as Error).message}`);
  }
}

function follow(id: string): void {
  unwatch?.();
  unwatch = watchProject(id, (row) => {
    void onRemote(row);
  });
}

async function onRemote(partial: ProjectRow): Promise<void> {
  if (!open || partial.id !== open.id || partial.version <= open.version)
    return;
  // Large rows may arrive without the layout; fetch the full row then.
  const row =
    partial.layout === undefined ? await getProject(partial.id) : partial;
  if (row.version <= open.version) return;
  if (!dirty) {
    applyRow(row, false);
    showToast(`Updated by ${who(row)}.`);
    return;
  }
  pendingRemote = row;
  banner(
    `<b>${esc(who(row))}</b> changed this project while you have unsaved edits.`,
    [
      {
        label: "Load their version",
        primary: true,
        run: () => pendingRemote && applyRow(pendingRemote, false),
      },
      {
        label: "Keep mine",
        run: () =>
          banner(
            "Keeping your version. Saving will replace theirs (it stays in the change log).",
          ),
      },
    ],
  );
}

async function save(): Promise<void> {
  if (!open) {
    await saveAs();
    return;
  }
  const layout = hooks.getLayout();
  try {
    const base =
      pendingRemote && pendingRemote.version > open.version
        ? pendingRemote.version
        : open.version;
    const r = await saveProject(
      open.id,
      base,
      layout,
      `Saved from the app (${layout.length} modules)`,
    );
    open.version = r.version;
    dirty = false;
    pendingRemote = null;
    banner(null);
    render();
    showToast("Saved to the cloud.");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("Conflict")) {
      const latest = await getProject(open.id);
      pendingRemote = latest;
      banner(
        `This project was changed by <b>${esc(who(latest))}</b> since you opened it.`,
        [
          {
            label: "Load their version",
            primary: true,
            run: () => applyRow(latest, false),
          },
          {
            label: "Overwrite with mine",
            run: () => {
              void save();
            },
          },
        ],
      );
    } else {
      window.alert(`Could not save: ${msg}`);
    }
  }
}

async function saveAs(): Promise<void> {
  const name = window.prompt(
    "Name for the cloud project:",
    open ? `${open.name} (copy)` : "New school",
  );
  if (!name?.trim()) return;
  try {
    const row = await createProject(name.trim(), hooks.getLayout());
    open = { id: row.id, name: row.name, version: row.version };
    fileName = null;
    rememberCloud(row.id);
    dirty = false;
    pendingRemote = null;
    banner(null);
    follow(row.id);
    render();
    showToast(`Saved as “${row.name}”.`);
  } catch (e) {
    window.alert(`Could not save: ${(e as Error).message}`);
  }
}

/** Remember the open cloud project so a reload reopens it (null = forget). */
function rememberCloud(id: string | null): void {
  try {
    if (id) localStorage.setItem("modulnor.cloudProject", id);
    else localStorage.removeItem("modulnor.cloudProject");
  } catch {
    /* storage unavailable */
  }
}

/** Stop following the cloud project (it stays in the cloud as it was). */
function leaveCloud(): void {
  unwatch?.();
  unwatch = null;
  open = null;
  pendingRemote = null;
  banner(null);
  rememberCloud(null);
}

/** Run `fn` once signed in, asking to sign in first if needed. */
function withSession(fn: () => void): void {
  if (session) fn();
  else showSignIn(fn);
}

// ── Public API (File menu) ───────────────────────────────────────────────────

/** Call after any local layout change. */
export function markCloudDirty(): void {
  if (applying || dirty) return;
  dirty = true;
  render();
}

/** True if the current layout has changes that were not saved anywhere. */
export const hasUnsavedChanges = (): boolean => dirty;

/** New, empty project (not saved anywhere yet). */
export function startNewProject(): void {
  leaveCloud();
  fileName = null;
  dirty = false;
  render();
}

/** The layout now comes from a file on this computer. */
export function setFileProject(name: string): void {
  leaveCloud();
  fileName = name;
  dirty = false;
  render();
}

/** Open → Cloud project… */
export function openCloudProject(): void {
  withSession(() => {
    void showOpen();
  });
}

/**
 * Save back to where the project lives. Returns false when it has never been
 * saved, so the caller can ask where (Save as).
 */
export async function saveCurrentProject(): Promise<boolean> {
  if (open) {
    await save();
    return true;
  }
  if (fileName) {
    const saved = await hooks.saveFile(fileName);
    if (saved) setFileProject(saved);
    return true;
  }
  return false;
}

/** Save as → New cloud project… */
export function saveAsCloudProject(): void {
  withSession(() => {
    void saveAs();
  });
}

/** Save as → Download file (.json) */
export async function saveAsFile(): Promise<void> {
  const saved = await hooks.saveFile(fileName ?? open?.name ?? undefined);
  if (saved) setFileProject(saved);
}

export async function initCloud(h: CloudHooks): Promise<void> {
  hooks = h;
  mount();
  dirty = false; // the empty start-up scene is not an unsaved change
  session = await currentSession();
  render();
  supabase.auth.onAuthStateChange((_event, s) => {
    const was = session?.user.id;
    session = s;
    if (!s) {
      if (open) {
        leaveCloud();
        dirty = false;
      }
    } else if (was !== s.user.id) void reopenLast();
    render();
  });
  if (session) await reopenLast();
}

async function reopenLast(): Promise<void> {
  let id: string | null = null;
  try {
    id = localStorage.getItem("modulnor.cloudProject");
  } catch {
    /* storage unavailable */
  }
  if (!id || open) return;
  try {
    const row = await getProject(id);
    if (row.archived_at) return;
    applyRow(row, true);
    follow(row.id);
  } catch {
    /* project gone or no access */
  }
}

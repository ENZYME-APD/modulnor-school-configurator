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

// Cloud projects panel: sign in, open/save shared projects, and follow live
// changes made by Claude (MCP) or colleagues while a project is open.

export interface CloudHooks {
  /** Current scene layout. */
  getLayout: () => SavedModule[];
  /** Replace the scene with a layout (undoable locally). */
  applyLayout: (modules: SavedModule[], opts: { fit: boolean }) => void;
}

interface OpenProject {
  id: string;
  name: string;
  version: number;
}

let hooks: CloudHooks;
let session: Session | null = null;
let open: OpenProject | null = null;
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
      <span class="cloud-title">Cloud project</span>
      <span id="cloud-user" class="cloud-user"></span>
    </div>
    <div id="cloud-name" class="cloud-name"></div>
    <div id="cloud-status" class="cloud-status"></div>
    <div id="cloud-banner" class="cloud-banner" hidden></div>
    <div class="cloud-actions">
      <button id="cloud-signin-btn" class="btn-secondary">Sign in</button>
      <button id="cloud-open-btn" class="btn-secondary">Open…</button>
      <button id="cloud-save-btn" class="btn-secondary">Save</button>
      <button id="cloud-saveas-btn" class="btn-secondary">Save as…</button>
      <button id="cloud-signout-btn" class="cloud-link">Sign out</button>
    </div>`;
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

  el("cloud-signin-btn").addEventListener("click", showSignIn);
  el("cloud-signout-btn").addEventListener("click", async () => {
    if (
      dirty &&
      !window.confirm(
        "You have unsaved changes in the cloud project. Sign out anyway?",
      )
    )
      return;
    await signOut();
  });
  el("cloud-open-btn").addEventListener("click", showOpen);
  el("cloud-save-btn").addEventListener("click", () => {
    void save();
  });
  el("cloud-saveas-btn").addEventListener("click", () => {
    void saveAs();
  });
}

function render(): void {
  const signedIn = !!session;
  el("cloud-user").textContent = signedIn ? (session!.user.email ?? "") : "";
  el("cloud-signin-btn").hidden = signedIn;
  el("cloud-open-btn").hidden = !signedIn;
  el("cloud-save-btn").hidden = !signedIn;
  el("cloud-saveas-btn").hidden = !signedIn;
  el("cloud-signout-btn").hidden = !signedIn;
  let name = "Sign in to share projects with the team and with Claude.";
  if (signedIn) name = open ? open.name : "Not saved to the cloud yet";
  el("cloud-name").textContent = name;
  el("cloud-name").classList.toggle("muted", !open);
  let status = "";
  if (open)
    status = dirty ? "Unsaved changes" : `Saved · version ${open.version}`;
  el("cloud-status").textContent = status;
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

function showSignIn(): void {
  const d = dialog(`
    <h3>Sign in</h3>
    <p class="cloud-hint">Use your Enzyme account. Ask an admin if you don't have one.</p>
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
    else d.close();
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
      listEl.innerHTML = `<p class="cloud-hint">No cloud projects yet. Use “Save as…” to put the current layout in the cloud.</p>`;
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
    try {
      localStorage.setItem("modulnor.cloudProject", row.id);
    } catch {
      /* storage unavailable */
    }
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

// ── Public API ───────────────────────────────────────────────────────────────

/** Call after any local layout change. */
export function markCloudDirty(): void {
  if (applying || !open || dirty) return;
  dirty = true;
  render();
}

/** A layout loaded from a file is no longer the open cloud project. */
export function detachCloudProject(): void {
  unwatch?.();
  unwatch = null;
  open = null;
  dirty = false;
  pendingRemote = null;
  banner(null);
  render();
}

export async function initCloud(h: CloudHooks): Promise<void> {
  hooks = h;
  mount();
  session = await currentSession();
  render();
  supabase.auth.onAuthStateChange((_event, s) => {
    const was = session?.user.id;
    session = s;
    if (!s) detachCloudProject();
    else if (was !== s.user.id) void reopenLast();
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

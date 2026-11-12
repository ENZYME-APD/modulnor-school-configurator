import { blueprints } from "../../src/data/blueprints";
import { electricalKits } from "../../src/data/electricalKits";
import { roofKits } from "../../src/data/roofKits";
import {
  footprint,
  levelOf,
  parseLayout,
  toHeadlessModules,
  yawDegrees,
  yForLevel,
  MODULE_HEIGHT,
  type SavedModule,
} from "../../src/core/layout";
import { computeBoq, groupBom } from "../../src/core/boq";
import {
  checkLayout,
  layoutBounds,
  type LayoutIssue,
} from "../../src/core/checks";
import { ARCHICAD_NOTES, toArchicadPlacements } from "../../src/core/archicad";
import type { ChangeRow, ProjectRow, SaveResult } from "../../src/cloud/config";
import type { McpContext } from "./context";

// Tools for the AI connection. Every query runs as the signed-in user (row-level
// security applies). Layout maths is the same code the browser app uses.

export class ToolError extends Error {}

type Json = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  writes?: boolean;
  destructive?: boolean;
  run: (args: Json, ctx: McpContext) => Promise<unknown>;
}

// ── Argument helpers ─────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MODULES_PER_CALL = 500;

function str(a: Json, k: string, required = false): string | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolError(`${k} is required.`);
    return undefined;
  }
  return String(v).trim();
}
/** A required string argument. */
const req = (a: Json, k: string): string => str(a, k, true) as string;
function num(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new ToolError(`${label} must be a number.`);
  return n;
}
const projectId = (a: Json) => {
  const id = req(a, "project_id");
  if (!UUID.test(id))
    throw new ToolError("project_id must be a project id from list_projects.");
  return id;
};
const list = (a: Json, k: string): unknown[] => {
  const v = a[k];
  if (!Array.isArray(v) || v.length === 0)
    throw new ToolError(`${k} must be a non-empty list.`);
  if (v.length > MAX_MODULES_PER_CALL)
    throw new ToolError(
      `${k}: at most ${MAX_MODULES_PER_CALL} items per call.`,
    );
  return v;
};
const P = (
  description: string,
  type: string | string[] = "string",
  extra: Json = {},
) => ({ type, description, ...extra });
const schema = (properties: Json, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const mm = (v: number) => Math.round(v * 1000) / 1000;
const rad = (deg: number) => (deg * Math.PI) / 180;

function typeKey(v: unknown, label: string): string {
  const k = String(v ?? "").trim();
  if (!blueprints[k])
    throw new ToolError(
      `${label}: unknown module type "${k}". See get_overview for the catalogue.`,
    );
  return k;
}
/** undefined = leave unchanged, null = clear, string = set */
function kit(
  v: unknown,
  label: string,
  catalogue: Record<string, unknown>,
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const k = String(v).trim();
  if (!catalogue[k])
    throw new ToolError(
      `${label}: unknown kit "${k}". Options: ${Object.keys(catalogue).join(", ")}.`,
    );
  return k;
}
function level(v: unknown, label: string): number | undefined {
  const n = num(v, label);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 0 || n > 20)
    throw new ToolError(
      `${label} must be a whole storey number from 0 (ground) to 20.`,
    );
  return n;
}

// ── Data access ──────────────────────────────────────────────────────────────

function check<T>(res: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (res.error) throw new ToolError(res.error.message);
  return (res.data ?? null) as NonNullable<T>;
}

async function loadProject(
  ctx: McpContext,
  id: string,
): Promise<ProjectRow & { modules: SavedModule[] }> {
  const row = check(
    await ctx.db.from("projects").select("*").eq("id", id).maybeSingle(),
  ) as ProjectRow | null;
  if (!row)
    throw new ToolError("Project not found. Use list_projects to see the ids.");
  const { modules } = parseLayout(row.layout);
  return { ...row, modules };
}

async function saveLayout(
  ctx: McpContext,
  project: ProjectRow,
  layout: SavedModule[],
  summary: string,
  name?: string,
): Promise<SaveResult> {
  const res = await ctx.db.rpc("save_project", {
    p_project_id: project.id,
    p_base_version: project.version,
    p_layout: layout,
    p_summary: summary,
    p_source: "mcp",
    p_change_id: `mcp:${globalThis.crypto.randomUUID()}`,
    p_name: name ?? null,
  });
  return check(res) as SaveResult;
}

/** Friendly view of one module for the assistant. */
function view(m: SavedModule) {
  const yaw = yawDegrees(m.rot);
  const bp = blueprints[m.typeKey];
  return {
    id: m.id,
    type: m.typeKey,
    group: bp.group,
    x: mm(m.pos.x),
    z: mm(m.pos.z),
    level: levelOf(m.pos.y),
    rotation_deg: yaw,
    footprint: footprint(m.typeKey, yaw),
    ...(m.elecKey ? { electrical_kit: m.elecKey } : {}),
    ...(m.roofKey ? { roof_kit: m.roofKey } : {}),
  };
}

const make = (
  type: string,
  x: number,
  z: number,
  lvl: number,
  yaw: number,
  elec?: string | null,
  roof?: string | null,
  id?: string,
): SavedModule => ({
  id: id ?? globalThis.crypto.randomUUID(),
  typeKey: type,
  ...(elec ? { elecKey: elec } : {}),
  ...(roof ? { roofKey: roof } : {}),
  pos: { x: mm(x), y: yForLevel(lvl), z: mm(z) },
  rot: { x: 0, y: rad(yaw), z: 0 },
});

/** Issues that involve any of the touched modules (what this change may have caused). */
function issuesFor(layout: SavedModule[], touched: Set<string>): LayoutIssue[] {
  return checkLayout(toHeadlessModules(layout)).filter(
    (i) => i.severity !== "info" && i.module_ids.some((id) => touched.has(id)),
  );
}

const done = (r: SaveResult, extra: Json) => ({
  change_id: r.change_id,
  version: r.version,
  ...extra,
  note: "The change is live in the app for anyone with this project open. Undo with undo_change and this change_id.",
});

function findIds(layout: SavedModule[], ids: unknown[]): Set<string> {
  const known = new Set(layout.map((m) => m.id));
  const set = new Set<string>();
  for (const v of ids) {
    const id = String(v);
    if (!known.has(id))
      throw new ToolError(
        `No module with id "${id}" in this project (see get_project).`,
      );
    set.add(id);
  }
  return set;
}

// ── Overview text ────────────────────────────────────────────────────────────

function catalogue() {
  return Object.entries(blueprints).map(([key, b]) => ({
    type: key,
    name: b.name,
    family: b.menuGroup,
    group: b.group,
    description: b.desc,
    size_m: {
      length_x: b.geometry.parameters.width,
      width_z: b.geometry.parameters.depth,
      height: b.geometry.parameters.height,
    },
    end_walls: b.walls,
    fee: b.cost,
  }));
}

const CONVENTIONS = [
  "Units are metres and degrees. Plan axes: x to the right, z towards the viewer (south in plan); y is up.",
  `x and z are the module's centre in plan. level is the storey: 0 = ground; each storey is ${MODULE_HEIGHT} m.`,
  "rotation_deg turns the module about the vertical axis, counter-clockwise seen from above. Use multiples of 90.",
  "At rotation 0 a module is 6 m along x and 2.44 m along z (footprint swaps at 90/270).",
  "Classrooms are built from 6 × 2.44 m strips placed side by side along their 2.44 m direction (local z). Type A is the left end (wall on its −z side), C the right end (wall on +z), B a middle strip with no end walls, D/E/AIM have both end walls.",
  "Two strips touching side by side form a link: no walls between them = standard link, one wall = panel link, two walls = simple link. A module stacked on another is a vertical link.",
  "Corridor modules are normally placed at rotation 90.",
  "Fees in the catalogue are placeholder values.",
];

// ── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: "get_overview",
    title: "Overview: catalogue, kits and conventions",
    description:
      "Start here. The module catalogue (types, sizes, end walls, fees), electrical and roof kits, the coordinate conventions, and how many projects exist.",
    inputSchema: schema({}),
    run: async (_a, ctx) => {
      const { count } = await ctx.db
        .from("projects")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null);
      return {
        signed_in_as: ctx.email,
        projects: count ?? 0,
        conventions: CONVENTIONS,
        module_types: catalogue(),
        electrical_kits: Object.entries(electricalKits).map(([k, v]) => ({
          key: k,
          name: v.name,
          description: v.desc,
        })),
        roof_kits: Object.entries(roofKits).map(([k, v]) => ({
          key: k,
          name: v.name,
          description: v.desc,
        })),
      };
    },
  },
  {
    name: "list_projects",
    title: "List projects",
    description:
      "Shared configurator projects: id, name, module count, version, and who changed it last and when.",
    inputSchema: schema({
      query: P("Only projects whose name contains this text"),
      include_archived: P("Also list archived projects", "boolean"),
    }),
    run: async (a, ctx) => {
      let q = ctx.db
        .from("projects")
        .select(
          "id, name, layout, version, updated_at, updated_by_email, updated_source, archived_at",
        )
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!a.include_archived) q = q.is("archived_at", null);
      const s = str(a, "query");
      if (s) q = q.ilike("name", `%${s.replace(/[%_]/g, "")}%`);
      const rows = check(await q) as ProjectRow[];
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        modules: Array.isArray(r.layout) ? r.layout.length : 0,
        version: r.version,
        updated_at: r.updated_at,
        updated_by: r.updated_by_email,
        updated_from: r.updated_source,
        ...(r.archived_at ? { archived_at: r.archived_at } : {}),
      }));
    },
  },
  {
    name: "get_project",
    title: "Get project layout",
    description:
      "A project's modules (id, type, centre x/z, level, rotation, footprint, kits), its overall size and a short summary. Module ids are used by the editing tools.",
    inputSchema: schema({ project_id: P("Project id") }, ["project_id"]),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const blocks = toHeadlessModules(p.modules);
      const boq = computeBoq(blocks);
      return {
        id: p.id,
        name: p.name,
        version: p.version,
        updated_at: p.updated_at,
        updated_by: p.updated_by_email,
        summary: {
          modules: p.modules.length,
          classrooms: boq.classrooms,
          corridors: boq.corridors,
          by_type: boq.modules,
          fee: boq.totalFee,
        },
        bounds: layoutBounds(blocks),
        modules: p.modules.map(view),
      };
    },
  },
  {
    name: "get_bom",
    title: "Bill of materials and fee",
    description:
      "Quantities for a project, as the app's BOM panel calculates them: module counts, links (standard/panel/simple/vertical), corridor dynamic walls, kit counts, the bill of materials grouped by category, and the fee.",
    inputSchema: schema({ project_id: P("Project id") }, ["project_id"]),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const boq = computeBoq(toHeadlessModules(p.modules));
      return {
        project: p.name,
        version: p.version,
        classrooms: boq.classrooms,
        corridors: boq.corridors,
        modules_by_type: boq.modules,
        links: {
          standard: boq.standardLinks,
          panel: boq.panelLinks,
          simple: boq.simpleLinks,
          vertical: boq.verticalLinks,
        },
        corridor_dynamic_walls_m: boq.dynamicWallMeters,
        electrical_kits: boq.elec,
        roof_kits: boq.roofs,
        bill_of_materials: groupBom(boq.bom),
        fee: {
          total: boq.totalFee,
          note: "Placeholder fee values from the module catalogue.",
        },
      };
    },
  },
  {
    name: "check_layout",
    title: "Check layout",
    description:
      "Quality checks: overlapping modules, modules with nothing below them, modules not on a storey, non-90° rotations, top modules without a roof kit, roofs under other modules, classrooms without an electrical kit.",
    inputSchema: schema({ project_id: P("Project id") }, ["project_id"]),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const issues = checkLayout(toHeadlessModules(p.modules));
      const count = (s: string) =>
        issues.filter((i) => i.severity === s).length;
      return {
        project: p.name,
        version: p.version,
        errors: count("error"),
        warnings: count("warning"),
        info: count("info"),
        issues,
      };
    },
  },
  {
    name: "export_archicad_placement",
    title: "Export Archicad placement",
    description:
      "Placement data for the Archicad hotlink script (Tapir CreateHotlinkNodes / CreateHotlinkInstances): one entry per module with Archicad coordinates, storey, rotation and kits, plus the list of hotlink files needed.",
    inputSchema: schema({ project_id: P("Project id") }, ["project_id"]),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const placements = toArchicadPlacements(p.modules);
      return {
        project: p.name,
        version: p.version,
        units: "m",
        notes: ARCHICAD_NOTES,
        hotlinks: [...new Set(placements.map((x) => x.hotlink))].sort(),
        storeys: [...new Set(placements.map((x) => x.storey))].sort(
          (x, y) => x - y,
        ),
        placements,
      };
    },
  },
  {
    name: "list_recent_changes",
    title: "Recent changes",
    description:
      "A project's change log: what changed, when, by whom, from where (app, AI assistant, undo) and whether it was undone.",
    inputSchema: schema(
      {
        project_id: P("Project id"),
        limit: P("How many (default 20, max 100)", "number"),
      },
      ["project_id"],
    ),
    run: async (a, ctx) => {
      const limit = Math.min(100, Math.max(1, num(a.limit, "limit") ?? 20));
      const rows = check(
        await ctx.db
          .from("project_changes")
          .select(
            "change_id, version, summary, source, actor_email, undone_by, created_at",
          )
          .eq("project_id", projectId(a))
          .order("version", { ascending: false })
          .limit(limit),
      ) as ChangeRow[];
      return rows.map((r) => ({
        change_id: r.change_id,
        version: r.version,
        summary: r.summary,
        from: r.source,
        by: r.actor_email,
        at: r.created_at,
        ...(r.undone_by ? { undone_by: r.undone_by } : {}),
      }));
    },
  },

  // ── Writes ────────────────────────────────────────────────────────────────
  {
    name: "create_project",
    title: "Create project",
    description:
      "Create a new shared project, empty or as a copy of another project's layout.",
    writes: true,
    inputSchema: schema(
      {
        name: P("Project name"),
        copy_from_project_id: P("Optional: copy the layout of this project"),
      },
      ["name"],
    ),
    run: async (a, ctx) => {
      const name = req(a, "name");
      let layout: SavedModule[] = [];
      const from = str(a, "copy_from_project_id");
      if (from) {
        if (!UUID.test(from))
          throw new ToolError("copy_from_project_id must be a project id.");
        layout = (await loadProject(ctx, from)).modules.map((m) => ({
          ...m,
          id: globalThis.crypto.randomUUID(),
        }));
      }
      const row = check(
        await ctx.db
          .from("projects")
          .insert({ name, layout, updated_source: "mcp" })
          .select("id, name, version")
          .single(),
      ) as Pick<ProjectRow, "id" | "name" | "version">;
      return {
        ...row,
        modules: layout.length,
        note: "Open it in the app with Cloud → Open.",
      };
    },
  },
  {
    name: "rename_project",
    title: "Rename project",
    description: "Rename a project.",
    writes: true,
    inputSchema: schema({ project_id: P("Project id"), name: P("New name") }, [
      "project_id",
      "name",
    ]),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const name = req(a, "name");
      const r = await saveLayout(
        ctx,
        p,
        p.modules,
        `Renamed "${p.name}" to "${name}"`,
        name,
      );
      return done(r, { name });
    },
  },
  {
    name: "add_modules",
    title: "Add modules",
    description:
      "Place new modules (one change). Each: type, x and z (centre, m), level (storey, default 0), rotation_deg (default 0; corridors default 90), electrical_kit, roof_kit. Returns the new ids and any problems the new modules cause (overlaps, nothing below). Before calling, tell the user what you will place and wait for confirmation.",
    writes: true,
    inputSchema: schema(
      {
        project_id: P("Project id"),
        modules: P("Modules to add", "array", {
          items: schema(
            {
              type: P(
                "Module type key from get_overview, e.g. A1, B2PD, CorridorStructure",
              ),
              x: P("Centre x (m)", "number"),
              z: P("Centre z (m)", "number"),
              level: P("Storey, 0 = ground", "integer"),
              rotation_deg: P(
                "Rotation about the vertical axis (degrees, CCW from above)",
                "number",
              ),
              electrical_kit: P("Electrical kit key (optional)"),
              roof_kit: P("Roof kit key (optional)"),
            },
            ["type", "x", "z"],
          ),
        }),
        summary: P("Optional short description of the change for the log"),
      },
      ["project_id", "modules"],
    ),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const added = list(a, "modules").map((raw, i) => {
        const m = (raw ?? {}) as Json;
        const label = `modules[${i}]`;
        const type = typeKey(m.type, label);
        const x = num(m.x, `${label}.x`);
        const z = num(m.z, `${label}.z`);
        if (x === undefined || z === undefined)
          throw new ToolError(`${label}: x and z are required.`);
        const yaw =
          num(m.rotation_deg, `${label}.rotation_deg`) ??
          (blueprints[type].group === "corridor" ? 90 : 0);
        return make(
          type,
          x,
          z,
          level(m.level, `${label}.level`) ?? 0,
          yaw,
          kit(m.electrical_kit, `${label}.electrical_kit`, electricalKits),
          kit(m.roof_kit, `${label}.roof_kit`, roofKits),
        );
      });
      const layout = [...p.modules, ...added];
      const summary =
        str(a, "summary") ??
        `Added ${added.length} module(s): ${summarizeTypes(added)}`;
      const r = await saveLayout(ctx, p, layout, summary);
      return done(r, {
        added: added.map(view),
        issues: issuesFor(layout, new Set(added.map((m) => m.id))),
      });
    },
  },
  {
    name: "update_modules",
    title: "Edit modules",
    description:
      "Change modules by id (one change): new x/z/level/rotation_deg, swap type, set electrical_kit or roof_kit (empty string clears). Fields left out stay as they are. Before calling, tell the user what will change and wait for confirmation.",
    writes: true,
    inputSchema: schema(
      {
        project_id: P("Project id"),
        changes: P("Edits", "array", {
          items: schema(
            {
              id: P("Module id from get_project"),
              type: P("New module type"),
              x: P("New centre x (m)", "number"),
              z: P("New centre z (m)", "number"),
              level: P("New storey", "integer"),
              rotation_deg: P("New rotation (degrees)", "number"),
              electrical_kit: P("Electrical kit key, or empty string to clear"),
              roof_kit: P("Roof kit key, or empty string to clear"),
            },
            ["id"],
          ),
        }),
        summary: P("Optional short description for the log"),
      },
      ["project_id", "changes"],
    ),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const changes = list(a, "changes") as Json[];
      const ids = findIds(
        p.modules,
        changes.map((c) => c?.id),
      );
      const byId = new Map(changes.map((c) => [String(c.id), c]));
      const layout = p.modules.map((m) => {
        const c = byId.get(m.id);
        if (!c) return m;
        const label = `change for ${m.id}`;
        const v = view(m);
        const type = c.type !== undefined ? typeKey(c.type, label) : m.typeKey;
        const elec = kit(
          c.electrical_kit,
          `${label}.electrical_kit`,
          electricalKits,
        );
        const roof = kit(c.roof_kit, `${label}.roof_kit`, roofKits);
        return make(
          type,
          num(c.x, `${label}.x`) ?? m.pos.x,
          num(c.z, `${label}.z`) ?? m.pos.z,
          level(c.level, `${label}.level`) ?? v.level,
          num(c.rotation_deg, `${label}.rotation_deg`) ?? v.rotation_deg,
          elec === undefined ? m.elecKey : elec,
          roof === undefined ? m.roofKey : roof,
          m.id,
        );
      });
      const summary = str(a, "summary") ?? `Edited ${ids.size} module(s)`;
      const r = await saveLayout(ctx, p, layout, summary);
      return done(r, {
        updated: layout.filter((m) => ids.has(m.id)).map(view),
        issues: issuesFor(layout, ids),
      });
    },
  },
  {
    name: "transform_modules",
    title: "Move, rotate or copy a group",
    description:
      "Move a group of modules by dx/dz (m) and dlevel (storeys), and/or rotate the group by rotate_deg (multiple of 90) about its centre — or copy=true to leave the originals and create moved copies (e.g. mirror a wing to the other side). One change. Before calling, tell the user what will change and wait for confirmation.",
    writes: true,
    inputSchema: schema(
      {
        project_id: P("Project id"),
        ids: P("Module ids", "array", { items: { type: "string" } }),
        dx: P("Move along x (m)", "number"),
        dz: P("Move along z (m)", "number"),
        dlevel: P("Move up/down by storeys", "integer"),
        rotate_deg: P(
          "Rotate the group about its plan centre (degrees CCW from above)",
          "number",
        ),
        copy: P("Create copies instead of moving the originals", "boolean"),
        summary: P("Optional short description for the log"),
      },
      ["project_id", "ids"],
    ),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const ids = findIds(p.modules, list(a, "ids"));
      const dx = num(a.dx, "dx") ?? 0;
      const dz = num(a.dz, "dz") ?? 0;
      const dl = num(a.dlevel, "dlevel") ?? 0;
      if (!Number.isInteger(dl))
        throw new ToolError("dlevel must be a whole number of storeys.");
      const rot = num(a.rotate_deg, "rotate_deg") ?? 0;
      const sel = p.modules.filter((m) => ids.has(m.id));
      const cx = sel.reduce((s, m) => s + m.pos.x, 0) / sel.length;
      const cz = sel.reduce((s, m) => s + m.pos.z, 0) / sel.length;
      const c = Math.cos(rad(rot));
      const s = Math.sin(rad(rot));
      const moved = sel.map((m) => {
        const v = view(m);
        // CCW from above in a Y-up frame with +z south: x' = cx + c·rx + s·rz, z' = cz − s·rx + c·rz
        const rx = m.pos.x - cx;
        const rz = m.pos.z - cz;
        const lvl = v.level + dl;
        if (lvl < 0)
          throw new ToolError("That would move modules below ground level.");
        return make(
          m.typeKey,
          cx + c * rx + s * rz + dx,
          cz - s * rx + c * rz + dz,
          lvl,
          (v.rotation_deg + rot) % 360,
          m.elecKey,
          m.roofKey,
          a.copy ? undefined : m.id,
        );
      });
      const layout = a.copy
        ? [...p.modules, ...moved]
        : p.modules.map((m) => moved.find((x) => x.id === m.id) ?? m);
      const what = [
        dx || dz ? `moved ${dx}, ${dz} m` : "",
        dl ? `${dl > 0 ? "up" : "down"} ${Math.abs(dl)} storey(s)` : "",
        rot ? `rotated ${rot}°` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const summary =
        str(a, "summary") ??
        `${a.copy ? "Copied" : "Transformed"} ${sel.length} module(s)${what ? `: ${what}` : ""}`;
      const r = await saveLayout(ctx, p, layout, summary);
      const touched = new Set(moved.map((m) => m.id));
      return done(r, {
        [a.copy ? "created" : "moved"]: moved.map(view),
        issues: issuesFor(layout, touched),
      });
    },
  },
  {
    name: "remove_modules",
    title: "Remove modules",
    description:
      "Delete modules by id (one change, undoable). Before calling, tell the user what will be removed and wait for confirmation.",
    writes: true,
    destructive: true,
    inputSchema: schema(
      {
        project_id: P("Project id"),
        ids: P("Module ids", "array", { items: { type: "string" } }),
        summary: P("Optional short description for the log"),
      },
      ["project_id", "ids"],
    ),
    run: async (a, ctx) => {
      const p = await loadProject(ctx, projectId(a));
      const ids = findIds(p.modules, list(a, "ids"));
      const removed = p.modules.filter((m) => ids.has(m.id));
      const layout = p.modules.filter((m) => !ids.has(m.id));
      const summary =
        str(a, "summary") ??
        `Removed ${removed.length} module(s): ${summarizeTypes(removed)}`;
      const r = await saveLayout(ctx, p, layout, summary);
      return done(r, { removed: removed.length, modules_left: layout.length });
    },
  },
  {
    name: "undo_change",
    title: "Undo a change",
    description:
      "Revert a change by its change_id (from a change result or list_recent_changes). Only the latest change of a project can be undone; undo later ones first.",
    writes: true,
    inputSchema: schema({ change_id: P("The change id") }, ["change_id"]),
    run: async (a, ctx) => {
      const r = check(
        await ctx.db.rpc("undo_project_change", {
          p_change_id: req(a, "change_id"),
        }),
      ) as SaveResult;
      return {
        undo_change_id: r.change_id,
        version: r.version,
        note: "Reverted. The app shows the restored layout.",
      };
    },
  },
  {
    name: "archive_project",
    title: "Archive or restore project",
    description:
      "Archive a project (hidden from lists, nothing deleted) or restore it with archived=false. Ask the user first.",
    writes: true,
    destructive: true,
    inputSchema: schema(
      {
        project_id: P("Project id"),
        archived: P("true to archive, false to restore", "boolean"),
      },
      ["project_id", "archived"],
    ),
    run: async (a, ctx) => {
      const id = projectId(a);
      const archived = a.archived !== false;
      const row = check(
        await ctx.db
          .from("projects")
          .update({ archived_at: archived ? new Date().toISOString() : null })
          .eq("id", id)
          .select("id, name, archived_at")
          .maybeSingle(),
      );
      if (!row) throw new ToolError("Project not found.");
      return row;
    },
  },
];

function summarizeTypes(mods: SavedModule[]): string {
  const counts: Record<string, number> = {};
  mods.forEach((m) => (counts[m.typeKey] = (counts[m.typeKey] ?? 0) + 1));
  return Object.entries(counts)
    .map(([k, n]) => `${n}× ${k}`)
    .join(", ");
}

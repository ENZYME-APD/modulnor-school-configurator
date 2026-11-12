# Modulnor School Configurator

> A BIM-powered web application for modular school building configuration and take-off generation.

![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.175-black?logo=threedotjs&logoColor=white)
![ThatOpen](https://img.shields.io/badge/ThatOpen_Components-3.2-FF6B35)
![License](https://img.shields.io/badge/License-Proprietary-red)

---

## Overview

**Modulnor School Configurator** is a 3D building information modelling (BIM) tool for configuring and visualising modular school buildings. It enables architects and project managers to:

- Visualise and navigate modular school layouts in an interactive 3D scene
- Switch between **perspective** and **plan (orthographic)** views
- Load and inspect IFC building models
- Generate **Bills of Materials (BOM)** from structured Excel datasets covering:
  - Structural components
  - Electrical systems
  - Classroom elements
  - Façade panels
  - Roof assemblies
  - Adosamientos (attachments)
- Export scenes to GLTF format

---

## Tech Stack

| Layer | Technology |
|---|---|
| Build tool | [Vite](https://vitejs.dev/) + TypeScript |
| 3D Engine | [Three.js](https://threejs.org/) |
| BIM Toolkit | [ThatOpen Components](https://thatopen.github.io/engine_components/) |
| Excel parsing | [SheetJS (xlsx)](https://sheetjs.com/) |
| Linting | ESLint (Airbnb config) + Prettier |

---

## Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x

---

## Getting Started

```bash
# 1. Clone the repository
git clone git@github.com:ENZYME-APD/modulnor-school-configurator.git
cd modulnor-school-configurator

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be available at `http://localhost:5173` (or the next available port).

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with HMR |
| `npm run build` | Type-check, build the app and bundle the MCP server |
| `npm run build:api` | Bundle only the MCP server (`server/` → `server/dist/handlers.mjs`) |
| `npm run preview` | Preview the production build locally |

---

## Project Structure

```
ThatModularApp/
├── src/
│   ├── main.ts              # Entry point — interaction, UI wiring, event handling
│   ├── scene/               # Viewer: renderer, cameras, lighting, AO, navigation, on-demand render loop
│   ├── modules/             # Module styling, placement/removal, undo history
│   ├── tools/               # Selection and OSNAP tools
│   ├── qc/                  # QC colour modes and corridor wall detection
│   ├── bom/                 # BOM/cost calculation, link detection, save/load/export
│   ├── ui/                  # Properties panel
│   ├── core/                # Pure layout engine (BOM, links, walls, checks, Archicad export) — shared with the server
│   ├── cloud/               # Supabase client, cloud projects panel, live sync
│   ├── consent.ts           # OAuth consent page script (connecting Claude)
│   ├── data/                # Module blueprints, electrical and roof kits
│   ├── store.ts / types.ts  # Shared app state and types
│   ├── style.css            # Global styles
│   └── bom.json             # Compiled Bill of Materials data
│
├── *_excel/                 # Source Excel datasets per building system
│   ├── structure_excel/
│   ├── electrical_excel/
│   ├── classroom_excel/
│   ├── facade_excel/
│   ├── roof_excel/
│   └── adosamientos_excel/
│
├── server/mcp/              # MCP server: JSON-RPC handler, tools, OAuth metadata
├── api/                     # Vercel functions: /api/mcp and OAuth discovery
├── oauth/consent.html       # OAuth consent page
├── generate_bom.mjs         # Script: compile Excel datasets → bom.json
├── TestFiles/               # Reference IFC / sample files for development
├── index.html               # App shell
├── vite.config.ts
├── tsconfig.json
└── .eslintrc.cjs
```

---

## Cloud projects and Claude (MCP)

Projects can be saved to the cloud (Supabase project `modulnor-configurator`) from the **Cloud project**
panel at the top of the sidebar. Cloud projects are shared by the team, keep a change log, and update
live in the app when someone else — or Claude — changes them. Saving and loading JSON files works as before.

**Connect Claude:** Settings → Connectors → *Add custom connector* →
`https://modulnor-school-configurator.vercel.app/api/mcp`, then sign in with your Enzyme account and allow access.

Claude can then:

| Read | Change (asks you first; every change is logged and undoable) |
|---|---|
| `get_overview` — catalogue, kits, coordinate conventions | `create_project` (empty or copy) · `rename_project` |
| `list_projects` · `get_project` (modules with x/z/level/rotation) | `add_modules` · `update_modules` (move, swap type, kits) |
| `get_bom` — same numbers as the app's BOM panel | `transform_modules` — move/rotate/copy a group |
| `check_layout` — overlaps, floating modules, missing kits | `remove_modules` · `archive_project` |
| `export_archicad_placement` — Tapir hotlink placement data | `undo_change` |
| `list_recent_changes` | |

How it works:

- `server/mcp/` is a small stateless MCP server (Streamable HTTP, JSON replies). Sign-in is OAuth 2.1 with
  Supabase Auth as the authorization server; the consent screen is `oauth/consent.html`.
- Every tool runs as the signed-in user, so row-level security applies. Layout changes go through the
  `save_project` database function (optimistic concurrency on `version`), which writes `project_changes`;
  `undo_project_change` reverts the latest change.
- BOM, links, walls and checks come from `src/core/`, the same code the browser uses.
- Accounts are created by an admin (Supabase → Authentication → Users → Add user); public sign-up is off.

---

## Generating the BOM

The Bill of Materials is pre-compiled from the Excel source files. To regenerate it after updating any `*_excel/` dataset:

```bash
node generate_bom.mjs
```

This outputs a fresh `src/bom.json` consumed by the application at build time.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch naming, commit style, and PR process.

---

## License

Copyright © 2026 **ENZYME APD**. All rights reserved.  
This software is proprietary and confidential. Unauthorised copying, modification, or distribution is strictly prohibited. See [LICENSE](./LICENSE) for details.

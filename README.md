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
| `npm run build` | Type-check and build production bundle |
| `npm run preview` | Preview the production build locally |

---

## Project Structure

```
ThatModularApp/
├── src/
│   ├── main.ts              # Application entry point — scene setup, UI, event handling
│   ├── style.css            # Global styles
│   ├── globals.ts           # Shared types and constants
│   ├── bom.json             # Compiled Bill of Materials data
│   ├── bim-components/      # Custom ThatOpen component extensions
│   └── ui-templates/        # HTML UI panel templates
│
├── *_excel/                 # Source Excel datasets per building system
│   ├── structure_excel/
│   ├── electrical_excel/
│   ├── classroom_excel/
│   ├── facade_excel/
│   ├── roof_excel/
│   └── adosamientos_excel/
│
├── generate_bom.mjs         # Script: compile Excel datasets → bom.json
├── TestFiles/               # Reference IFC / sample files for development
├── index.html               # App shell
├── vite.config.ts
├── tsconfig.json
└── .eslintrc.cjs
```

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

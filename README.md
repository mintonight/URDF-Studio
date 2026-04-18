<div align="center">

# URDF Studio

[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.181-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Professional robot design, assembly, visualization, and export workstation for `URDF`, `MJCF`, `USD`, `Xacro`, `SDF`, and `.usp` project workflows.

**Live demo:** [urdf.d-robotics.cc](https://urdf.d-robotics.cc/)

[English](./README.md) | [中文](./README_CN.md)

</div>

---

## Overview

URDF Studio is a browser-based robot authoring environment built for editing robot topology, visual/collision geometry, hardware parameters, and multi-file workspaces without dropping down to raw XML for every operation.

The current app combines:

- `Skeleton`, `Detail`, and `Hardware` editing modes
- multi-robot assembly with bridge joints and workspace file management
- worker-assisted import/export pipelines
- USD runtime hydration, prepared export caches, and roundtrip archive flows
- AI-assisted generation, inspection, and report export
- a reusable `@urdf-studio/react-robot-canvas` package workspace

Package identity:

- root app: `urdf-studio@2.0.0` (private workspace app)
- published package: `@urdf-studio/react-robot-canvas@0.1.0`

Versioning policy:

- the private app and the published package use independent semantic versions
- the app version is injected into the frontend build and shown in the About dialog
- bump versions through `npm run version:bump` instead of editing manifests by hand

## Core Capabilities

### Editing

- Build and edit kinematic trees with link/joint topology tools
- Author visual meshes, collision meshes, measurements, and helper overlays
- Configure motors and hardware metadata
- Switch between authoring modes through a unified viewer shell

### Workspace and Assembly

- Import single files, folders, ZIP bundles, and `.usp` project archives
- Maintain workspace file trees, source text, and selection sync
- Assemble multiple robots into one workspace with bridge joints
- Preserve history, pending edits, and prepared robot resolution caches

### Visualization

- React Three Fiber workspace canvas shared by the visualizer and URDF/USD viewer
- Runtime URDF/MJCF viewer plus vendored USD viewer runtime
- USD stage preparation, hydration, metadata extraction, and offscreen worker rendering paths
- Snapshot capture, helper overlays, transform controls, and collision editing workflows

### Export and Interop

- Export `URDF`, `MJCF`, `USD`, `SDF`, `Xacro`, CSV/BOM, PDF, ZIP, and `.usp`
- Workerized project archive, USD export, and USD binary archive conversion
- Roundtrip-oriented USD archive generation and prepared export caches
- Reusable `react-robot-canvas` package for external consumers

## Tech Stack

- **Frontend**: React 19.2, TypeScript 5.8, Vite 6.2
- **3D**: Three.js 0.181, React Three Fiber 9, Drei 10
- **State**: Zustand 5
- **Styling**: Tailwind CSS 4
- **Parsing / Export**: custom URDF, MJCF, USD, Xacro, SDF, and mesh pipelines under `src/core`
- **Packaging**: JSZip, jsPDF
- **Package workspace**: `packages/react-robot-canvas`

## Repository Layout

```text
src/
  app/                  App shell, orchestration, overlays, shared viewer handoff
  features/             Domain features (visualizer, urdf-viewer, file-io, code-editor, ...)
  store/                Zustand stores
  shared/               Shared UI, 3D infrastructure, i18n, debug helpers, data
  core/                 Parsers, generators, loaders, robot logic
  lib/                  Reusable in-repo library surface
  styles/               Global styles and semantic tokens
  types/                Cross-module types
packages/react-robot-canvas/
  Reusable package build and publish workspace
docs/
  Architecture notes, runtime audits, contributor prompt context
scripts/
  Regression, schema generation, comparison, and local tooling scripts
log/
  Local runtime logs and retained troubleshooting output
.tmp/
  Temporary build/runtime scratch artifacts used by some scripts
.worktrees/
  Local git worktree area when using isolated workspaces
public/
  Static assets, Monaco, USD bindings, sample robots
tmp/
  Screenshots, traces, temporary validation artifacts
output/
  User-facing exports and retained verification artifacts
test/
  Fixture corpora, browser regression samples, and external mirrored projects
```

Architecture notes:

- `src/app` is not a thin shell. It is the orchestration layer split into `components/`, `hooks/`, `utils/`, and `workers/`, and owns document loading, viewer handoff, import/export coordination, pending history, and binary/archive worker bridges.
- `src/features/urdf-viewer` is currently the heaviest feature area. It combines React UI, a vendored USD runtime, adapter/util layers, prepared-open/export helpers, and worker-backed offscreen rendering.

## Getting Started

### Prerequisites

- Node.js 18 or newer
- npm
- A modern Chromium-based browser for local USD validation

### Install

```bash
git clone https://github.com/OpenLegged/URDF-Studio.git
cd URDF-Studio
npm install
```

### Optional Environment Variables

The app can run without AI credentials. If you want AI generation / inspection enabled, set the environment variables that `vite.config.ts` injects into the frontend runtime:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini

# Optional alternative source used by the current Vite define shim
GEMINI_API_KEY=

# Optional Monaco override
VITE_MONACO_VS_PATH=
```

You can place them in `.env.local`.

### Run the App

```bash
npm run dev
```

Open:

- `http://127.0.0.1:3000`

The Vite dev server is intentionally bound to `127.0.0.1` and serves the cross-origin isolation headers required by the USD WASM runtime.

## USD Runtime Requirements

USD loading depends on `SharedArrayBuffer`, so the page must be cross-origin isolated.

- Use `npm run dev` for development
- Use `npm run preview` to validate the production build locally
- Prefer `127.0.0.1` / `localhost` or HTTPS
- Do not serve `dist/` with a plain static server that omits these headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

If those headers are missing, the app shell may load but USD import / stage open will fail.

## Useful Commands

```bash
# App
npm run dev
npm run build
npm run preview

# Versioning
npm run version:show
npm run version:bump -- --app minor
npm run version:bump -- --package patch

# Reusable package workspace
npm run build:package:react-robot-canvas
npm run pack:package:react-robot-canvas

# Schema / comparison helpers
npm run code-editor:generate-urdf-schema
npm run mjcf:compare
npm run sdf:compare

# Regression helpers
npm run regression:shadow-hand-hover
npx tsx scripts/regression/validate_unitree_model_roundtrip_archive.ts

# Codex resilience / key-router helpers
npm run codex:retry
npm run codex:gui
npm run codex:key-router:deploy:dry
```

Additional script families under `scripts/` include URDF inspection helpers, robot preview generation, MuJoCo/MJCF comparison utilities, regression runners, and local Codex support tooling.

## Testing and Verification

This repository now exposes root quality commands for formatting, linting, and CI validation:

- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck:quality`
- `npm run check`

`npm run typecheck` remains available as the full-repo TypeScript debt check. CI and `npm run check` use `npm run typecheck:quality`, which currently excludes test/spec files so runtime compilation can stay green while test fixtures are still being updated.

Git hooks are wired through Husky + lint-staged + Commitlint:

- `pre-commit`: formats staged files and runs ESLint / Stylelint on the staged diff
- `commit-msg`: validates Conventional Commit messages

`npm test` stays limited to repo-contained tests that do not require the external fixture corpora under `test/`.

Validation is typically done through:

- targeted `node --test` / `npx tsx --test` runs next to the changed module
- focused regression scripts under `scripts/regression/`
- `npm test` for the fast repo-contained lane used by `npm run verify:fast`
- `npm run build`
- package workspace builds when touching `src/lib` or `packages/react-robot-canvas`
- fixture-driven checks under `test/` via `npm run test:fixtures:*` / `npm run verify:full`, especially `test/unitree_model`, `test/gazebo_models`, `test/awesome_robot_descriptions_repos`, and `test/usd-viewer`

## Documentation

- [Changelog](./CHANGELOG.md)
- [Release Process](./RELEASING.md)
- [Architecture Boundaries](./docs/architecture-boundaries.md)
- [Robot Canvas Library](./docs/robot-canvas-lib.md)
- [Runtime Fallback Audit](./docs/runtime-fallback-audit.md)
- [Contributor Prompt Context](./docs/prompts/CLAUDE.md)
- [Agent Instructions](./AGENTS.md)

## Package Workspace

The repository also contains the publishable package workspace:

- [`packages/react-robot-canvas`](./packages/react-robot-canvas)

This package currently provides a reusable `RobotCanvas` surface for external React apps that need URDF/MJCF viewing without the full URDF Studio shell.

## Contribution Notes

- Keep dependency direction aligned with `app -> features -> store -> shared -> core -> types`
- Prefer existing hooks / utilities over duplicating viewer or export logic
- Follow the runtime and style constraints documented in [AGENTS.md](./AGENTS.md)
- Put temporary screenshots, traces, and browser artifacts under `tmp/`

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](./LICENSE).

## Acknowledgments

Supported by [D-Robotics](https://developer.d-robotics.cc/).

[![Star History Chart](https://api.star-history.com/svg?repos=OpenLegged/URDF-Studio&type=date&legend=top-left)](https://www.star-history.com/#OpenLegged/URDF-Studio&type=date&legend=top-left)

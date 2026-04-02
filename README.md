# Nucleus

Monorepo for the Nucleus desktop ADE and its supporting surfaces.

Nucleus is a local-first coding environment for supervised, agentic software development. Projects in the app are folder-backed workspaces with chats, plans, tools, files, and approvals scoped to that local context.

## Prerequisites

- [Bun](https://bun.sh) v1.0+

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```


## Usage

**Desktop app (Electron + renderer HMR)**:
```bash
bun run dev
```

**Marketing site**:
```bash
bun run site:dev
```

**Preview the built desktop app**:
```bash
bun run preview
```

**CLI (OpenCode SDK, streaming by default)**:
```bash
bun run desktop:cli "What files are in this repo?"
# Stream tool calls
bun run desktop:cli "What files are in this repo?" --stream-tools
# Disable streaming
bun run desktop:cli "What files are in this repo?" --no-stream
# Only show raw response
bun run desktop:cli "What files are in this repo?" --raw-only
# Only show raw JSON
bun run desktop:cli "What files are in this repo?" --json-only
```

**Type checking**:
```bash
bun run typecheck
```

**Build all packages**:
```bash
bun run build
```

**Build a standalone macOS app for local install/testing**:
```bash
bun run desktop:dist:local
```

This packages the Electron app without using a dev server and disables automatic Apple identity discovery so it still works on Macs that do not have Apple developer signing keys installed. The app bundle is written to `apps/desktop/dist/mac-arm64/Nucleus.app`. For local installs on the same Mac, that `.app` is enough: drag it into `/Applications` or launch it directly.

Unsigned or ad hoc signed builds are fine for local testing, but macOS Gatekeeper may still warn when you open a copied or downloaded build. On the destination Mac, either use Finder's `Open` action once or remove quarantine with:

```bash
xattr -dr com.apple.quarantine apps/desktop/dist/mac-arm64/Nucleus.app
```

## Project Structure

```
nucleus/
├── apps/
│   ├── desktop/          # Electron app, CLI, and desktop-specific assets
│   └── site/             # Marketing website package
├── docs/                 # Product and implementation notes
├── package.json          # Bun workspace scripts
└── MIGRATION.md          # Product migration notes
```

## Features

- Bun workspace monorepo with isolated app packages
- Desktop UI shell with React + Electron
- Local-first project workspaces backed by folders
- Coding-focused ADE workflows for chat, tools, and approvals
- Marketing site package for public product storytelling
- Shared layout system (sidebars, title bar, main content)
- Typed preload bridge for filesystem, terminal, git, Codex, skills, and updates
- Theming based on system preference

## Development Phases

See [MIGRATION.md](./MIGRATION.md) for the full plan.

1. **Phase 1 (Current)**: UI shell with Electron + React
2. **Phase 2**: Coding runtime and harness integration
3. **Phase 3**: Migrate UI components from claude-interface project

## Resources

- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [React Documentation](https://react.dev/)
- [electron-vite Documentation](https://electron-vite.org/)

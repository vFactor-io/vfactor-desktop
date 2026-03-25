# Nucleus Desktop

Desktop Agentic Developer Environment (ADE) with Electron + React.

Nucleus Desktop is a local-first coding workspace for agentic software development. Each workspace in the app is a project backed by a local folder, with chats, tools, files, and approvals scoped to that project.

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

**Preview the built app**:
```bash
bun run preview
```

**CLI (OpenCode SDK, streaming by default)**:
```bash
bun run cli "What files are in this repo?"
# Stream tool calls
bun run cli "What files are in this repo?" --stream-tools
# Disable streaming
bun run cli "What files are in this repo?" --no-stream
# Only show raw response
bun run cli "What files are in this repo?" --raw-only
# Only show raw JSON
bun run cli "What files are in this repo?" --json-only
```

**Type checking**:
```bash
bun run typecheck
```

**Bundle the app**:
```bash
bun run dist
```

## Project Structure

```
nucleus-desktop/
├── src/                  # React renderer
├── electron/             # Electron main/preload/services
├── build/icons/          # Packaging icons
├── package.json          # Dependencies, scripts, electron-builder config
├── electron.vite.config.ts
└── MIGRATION.md          # Product migration notes
```

## Features

- Desktop UI shell with React + Electron
- Local-first project workspaces backed by folders
- Coding-focused ADE workflows for chat, tools, and approvals
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

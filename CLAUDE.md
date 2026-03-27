# Nucleus Desktop

Open-source desktop AI co-worker app with Electron + React.

## Product Direction

Nucleus Desktop is intended to become an open-source analogue to Claude Cowork: a desktop agent workspace for knowledge work beyond coding.

- The target experience is outcome-oriented task execution, not just turn-by-turn chat.
- Users should be able to grant scoped access to local folders, tools, connectors, and browser workflows so the agent can complete multi-step work on their behalf.
- The app should feel supervised and transparent: show plans, progress, sub-task activity, and require explicit approval for major or destructive actions.
- Prioritize knowledge-work use cases such as research, report and document drafting, spreadsheet/presentation prep, file organization, and recurring operational tasks.
- Keep provider-specific runtimes behind thin adapters so OpenCode, Codex, Claude Code, and future harnesses can power the same shared co-worker UX.

## Project Overview

This project is being built in phases:

1. **Phase 1 (Current)**: UI shell with Electron + React
2. **Phase 2**: Agent runtime integration
3. **Phase 3**: Migrate UI components from claude-interface project

## Commands

```bash
bun run dev                        # Run the desktop app in development
bun run desktop:dev                # Run the desktop app explicitly
bun run site:dev                   # Run the marketing site
bun run build                      # Build desktop + site packages
bun run desktop:cli "prompt"       # Run OpenCode CLI (streams by default)
bun run desktop:cli "prompt" --stream-tools  # Stream tool activity
bun run desktop:cli "prompt" --raw-only      # Only show raw response
bun run desktop:cli "prompt" --json-only     # Only show raw JSON
bun run typecheck                  # TypeScript type checking for the desktop app
```

## Architecture

### Current (Phase 1 - UI shell)
```
nucleus/
├── apps/
│   ├── desktop/           # Electron shell, renderer, CLI, packaging assets
│   └── site/              # Marketing website package
├── package.json           # Bun workspace scripts
└── MIGRATION.md           # Detailed migration plan
```

### Target (Phase 2+)
```
nucleus/
├── apps/
│   ├── desktop/
│   │   ├── electron/      # Electron shell, IPC, and native services
│   │   └── src/
│   │       ├── runtime/   # ADE runtime integration (TBD)
│   │       └── features/  # UI features (migrated from claude-interface)
│   │           ├── chat/  # Chat UI components
│   │           └── shared/  # Shared UI components
│   └── site/              # Public marketing site
└── ...
```

## Key Dependencies

- `bun` - JavaScript runtime and package manager
- `electron` / `electron-vite` - Desktop shell and dev/build tooling
- `@opencode-ai/sdk` - OpenCode SDK

## UI Migration Notes

The UI from `claude-interface` project will be migrated here. Key components to bring over:

- `ChatMessages.tsx` - Message rendering with AgentActivity
- `AgentActivity.tsx` - Collapsible activity panel
- `AgentActivityTool.tsx` - Tool call cards
- `ai-elements/` - Message, Conversation, Loader components
- `shared/components/ui/` - Button, Input, Dialog, etc.

These components have already been decoupled from the old ACP implementation and use local types compatible with a future ADE runtime.

## Development Guidelines

- Use Bun instead of Node.js
- Use ESM modules (`type: "module"`)
- TypeScript strict mode enabled
- No Vite - use Bun's built-in bundler when adding frontend

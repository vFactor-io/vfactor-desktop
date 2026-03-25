# Nucleus Desktop

Open-source desktop coding ADE with Electron + React.

## First Design Principles

- Design the application to be local-first wherever practical: data, permissions, project context, and core workflows should prefer running on the user's machine.
- Limit reliance on third-party services and hosted infrastructure. Favor local capabilities or thin, optional integrations so the system stays understandable, portable, and easy for the person installing it to manage themselves.

## Product Direction

Nucleus Desktop is intended to become an open-source coding ADE: a desktop environment for supervised, agentic software development.

- The primary unit in the product is a project backed by a local folder. In product copy, navigation, and UX discussions, refer to these folder-backed units as projects rather than agents.
- Local-first operation is a core product principle. When choosing architecture, dependencies, or UX flows, prefer approaches that keep the app self-managed on the user's machine and avoid unnecessary external services.
- Chats, plans, tools, files, and approvals all live inside a project context. Switching the selected project should switch the active chat/thread context with it.
- The target experience is outcome-oriented software development, not just turn-by-turn chat.
- Users should be able to grant scoped access to local folders, tools, connectors, and browser workflows so the ADE can complete multi-step coding work on their behalf.
- The app should feel supervised and transparent: show plans, progress, sub-task activity, and require explicit approval for major or destructive actions.
- Prioritize coding use cases such as repo exploration, implementation, refactoring, debugging, code review, and multi-step development tasks.
- Keep provider-specific runtimes behind thin adapters so OpenCode, Codex, Claude Code, and future harnesses can power the same shared ADE UX.

## Terminology

- "Project" means a user-defined, folder-backed coding workspace with its own threads, tools, and permissions.
- Avoid calling these user-facing entities "agents" unless referring to code-level legacy types or provider/runtime concepts that have not been renamed yet.
- The repository itself can still be called the project; the product surface should prefer project/workspace language consistently.

## Project Overview

This project is being built in phases:

1. **Phase 1 (Current)**: UI shell with Electron + React
2. **Phase 2**: Coding runtime and harness integration
3. **Phase 3**: Migrate UI components from Codex-interface project

## Commands

```bash
bun run dev                # Run Electron app in development
bun run build              # Build Electron app
bun run cli "prompt"       # Run OpenCode CLI (streams by default)
bun run cli "prompt" --stream-tools  # Stream tool activity
bun run cli "prompt" --raw-only      # Only show raw response
bun run cli "prompt" --json-only     # Only show raw JSON
bun run typecheck          # TypeScript type checking
```

## Architecture

### Current (Phase 1 - UI shell)
```
nucleus-desktop/
├── src/                   # React UI shell
├── electron/              # Electron main/preload/services
├── package.json
├── tsconfig.json
└── MIGRATION.md           # Detailed migration plan
```

### Target (Phase 2+)
```
nucleus-desktop/
├── electron/              # Electron shell, IPC, and native services
├── src/
│   ├── runtime/           # ADE runtime and harness integration (TBD)
│   └── features/          # UI features (migrated from Codex-interface)
│       ├── chat/          # Chat/thread UI scoped to the selected project
│       └── shared/        # Shared UI components
└── ...
```

## Key Dependencies

- `bun` - JavaScript runtime and package manager
- `electron` / `electron-vite` - Desktop shell and dev/build tooling
- `@opencode-ai/sdk` - OpenCode SDK

## UI Migration Notes

The UI from `Codex-interface` project will be migrated here. Key components to bring over:

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

## Integration Learnings

- The current chat runtime is still OpenCode-shaped end-to-end, and it now runs through the Electron desktop bridge.
- The product direction has changed from an agent-builder framing to a coding ADE with project-backed workspaces. Existing stores/types may still say `agent` in places, but new UX and architectural work should treat that layer as project selection with chat threads nested under each project.
- If adding multiple coding harnesses (OpenCode, Codex, Claude Code), keep orchestration out of this app and introduce a thin per-harness adapter that maps each provider into shared UI-local thread/message/tool/subagent types before data reaches hooks or components.
- Codex is not a drop-in replacement for the OpenCode client. The closest fit is Codex App Server, which uses JSON-RPC `thread/*` and `turn/*` events instead of OpenCode's REST/SSE shape; prefer generating version-matched bindings with `codex app-server generate-ts` rather than hand-rolling protocol types.
- Claude Cowork is still a useful product reference for supervised agentic workflows, but Nucleus Desktop should stay focused on coding-first ADE experiences built around local projects.
- For app UI controls, prefer the shared `shared/components/ui` primitives and standard sizing over one-off button/input overrides; search fields should use the shared `InputGroup` pattern unless a custom design is explicitly requested.
- Sidebar chrome should use the standard sidebar tokens (`bg-sidebar`, `--sidebar-item-hover`, `--sidebar-item-active`) rather than the older translucent/glass backgrounds so both sidebars read as the same surface.
- When a sidebar header opens a `DropdownMenu`, drive the trigger's visual active state with local `onOpenChange` state and use the shared radius tokens (`--radius-*`) instead of arbitrary extra-round corners.
- Treat chat performance as a core architectural requirement: keep the composer isolated from timeline re-renders, normalize timeline rows before rendering, and prefer virtualization/batched streaming updates over ad hoc memoization once threads get large.
- Codex assistant turns can surface the same content twice with different ids during streaming/final reconciliation (for example provisional `item-*` ids and canonical `msg_*` ids), so chat message merges should dedupe semantically instead of assuming ids alone are stable.
- If assistant paragraph spacing looks broken in chat, check persisted `chat.json` before changing the adapter: in this app the `\n\n` paragraph breaks survived storage, and the bug was in markdown paragraph rendering/styling rather than model output.
- For instant first-message UX without flicker, keep a stable local session id for the UI and store the real harness thread id separately (`remoteId`); promote the optimistic session in place instead of replacing it when the adapter finishes booting the remote thread.
- There are already in-progress extraction seams under `src/features/chat/components/composer/` and `src/features/chat/store/`; extend those instead of creating parallel refactor folders so the chat/composer architecture converges on one set of boundaries.

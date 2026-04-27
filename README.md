# vFactor

vFactor is an open-source desktop ADE for supervised, agentic software development.

It is built around local projects: folder-backed coding workspaces where chats, plans, tools, files, terminals, git state, and approvals all live together. The goal is to make agentic coding feel less like handing work to a black box and more like working inside a transparent development environment that you can supervise, understand, and shape.

vFactor is early, moving quickly, and intentionally local-first.

## What Is An ADE?

An Agentic Development Environment is a coding workspace designed for collaborating with software agents. Instead of treating AI as a detached chat panel, an ADE gives the agent project context, tool access, file visibility, progress surfaces, and approval boundaries inside one supervised workspace.

vFactor is focused on coding work: exploring repositories, planning changes, implementing features, debugging, reviewing code, managing git state, and running local tools.

## Why vFactor?

Most agentic coding tools either hide too much or depend too heavily on hosted systems. vFactor takes a different path:

- **Local-first by default**: projects are backed by folders on your machine.
- **Transparent work**: plans, tool calls, file activity, terminal output, and approvals are visible in the app.
- **Project-scoped context**: each project keeps its own chats, files, permissions, and runtime state.
- **Provider-flexible architecture**: OpenCode, Codex, Claude Code, and future harnesses should be able to power the same shared UI through thin adapters.
- **Supervised autonomy**: agents can do meaningful multi-step work, but major or destructive actions should remain explicit.
- **Open-source product direction**: the app should be understandable, portable, and hackable by the people using it.

## Inspiration

vFactor is heavily inspired by [T3 Code](https://github.com/pingdotgg/t3code), the open-source GUI for coding agents from the T3 team. T3 Code helped make the shape of this category feel obvious: local projects, agent sessions, git/worktree-aware workflows, and a fast desktop-style interface for supervising coding agents.

vFactor is exploring that same broad direction with its own emphasis on local-first project context, transparent approvals, and provider-flexible runtime adapters.

## Current Status

vFactor is in active development. The desktop shell, project-oriented UI, chat surfaces, sidebars, editor/file views, git surfaces, runtime bridge work, and packaging flow are already in motion. Some internals may still use older `agent` naming while the product surface moves toward project/workspace terminology.

The current app is best understood as a desktop foundation for a local-first coding ADE, not a finished commercial product.

## Features

- Electron desktop app with React UI
- Local project/workspace model
- Chat and timeline surfaces for coding tasks
- File browser, file preview, and editor-oriented UI
- Terminal and git-aware desktop bridge
- Approval-oriented architecture for supervised tool use
- Runtime integration work for coding harnesses
- Themeable app shell with shared UI primitives
- Marketing site package for public-facing product work
- Local macOS packaging for standalone app testing

## Tech Stack

- **Runtime/package manager**: Bun
- **Desktop shell**: Electron
- **Desktop build tooling**: electron-vite and electron-builder
- **Frontend**: React, TypeScript, Tailwind CSS
- **State/UI**: Zustand, shadcn-style primitives, Radix/Base UI pieces
- **Coding/runtime integrations**: OpenCode SDK, Claude Agent SDK, Codex-facing bridge work
- **Editor/files**: Monaco, tree/diff utilities, local filesystem bridge

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- macOS is the primary development target today

### Install

```bash
bun install
```

### Run The Desktop App

```bash
bun run dev
```

This starts the Electron desktop app in development mode.

### Run The Marketing Site

```bash
bun run site:dev
```

### Typecheck

```bash
bun run typecheck
```

### Build Everything

```bash
bun run build
```

## CLI Runtime Smoke Tests

The desktop package includes a CLI path for exercising the current runtime integration.

```bash
bun run desktop:cli "What files are in this repo?"
```

Useful variants:

```bash
bun run desktop:cli "What files are in this repo?" --stream-tools
bun run desktop:cli "What files are in this repo?" --raw-only
bun run desktop:cli "What files are in this repo?" --json-only
```

## Local Desktop Builds

To build a standalone macOS app for local install/testing:

```bash
bun run desktop:dist:local
```

This packages the Electron app without relying on a dev server and disables automatic Apple identity discovery so it works on Macs without Apple developer signing keys installed.

The local app bundle is written to:

```text
release/mac-arm64/vFactor.app
```

For local testing on the same Mac, you can launch that `.app` directly or move it into `/Applications`.

Unsigned or ad hoc signed builds are fine for local testing, but macOS Gatekeeper may warn when opening a copied or downloaded build. On the destination Mac, use Finder's `Open` action once or remove quarantine:

```bash
xattr -dr com.apple.quarantine release/mac-arm64/vFactor.app
```

## Repository Structure

```text
vfactor/
├── apps/
│   ├── desktop/
│   │   ├── electron/     # Electron shell, IPC, native services
│   │   └── src/          # Renderer UI, runtime integrations, shared features
│   └── site/             # Marketing website package
├── docs/                 # Product and implementation notes
├── scripts/              # Workspace and packaging helpers
└── package.json          # Bun workspace scripts
```

## Development Principles

vFactor is guided by a few durable product and engineering principles:

- Prefer local data, local permissions, local project context, and local execution wherever practical.
- Keep hosted services optional and thin.
- Treat projects as the main user-facing unit of work.
- Keep provider-specific runtime details behind adapters.
- Make agent work visible: progress, plans, tool calls, approvals, and results should be inspectable.
- Optimize for real coding workflows over generic chatbot behavior.
- Build UI primitives that can support repeated daily work, not just demos.

## Contributing

This project is young, so the most useful contributions are concrete and grounded:

- Fix a bug you can reproduce locally.
- Improve a rough edge in the desktop workflow.
- Tighten project/workspace terminology in the UI.
- Add focused documentation for a real setup or development path.
- Improve runtime adapter boundaries without coupling the UI to one provider.
- Make the app feel calmer, clearer, and more trustworthy for supervised coding work.

Before opening a larger change, prefer a small issue or discussion that explains the workflow you want to improve.

## Useful Commands

```bash
bun run dev                 # Run the desktop app
bun run desktop:dev         # Run the desktop app explicitly
bun run site:dev            # Run the marketing site
bun run typecheck           # TypeScript type checking
bun run build               # Build desktop and site packages
bun run desktop:dist:local  # Build a local standalone macOS app
```

## Roadmap

The near-term direction is to keep turning the desktop shell into a capable ADE:

- Stronger project-scoped chat and thread persistence
- Clearer runtime adapter seams for multiple coding harnesses
- Better plans, progress, and sub-task activity views
- More complete file, terminal, git, and approval workflows
- Packaging polish for local testing and eventual distribution
- Continued migration from legacy agent terminology to project/workspace language

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for full terms.

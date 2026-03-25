# Nucleus Desktop - Migration Plan

This document details the migration from `claude-interface` (custom ACP implementation) to `nucleus-desktop`.

## Background

The `claude-interface` project had a custom ACP (Agent Client Protocol) implementation:
- **Backend runtime**: Managed stdio JSON-RPC communication with the coding runtime
- **TypeScript frontend**: React hooks, Zustand store, permission handling

This was overly complex. We are moving to a simpler agent runtime integration (TBD).

## What We're Keeping

**Significant time was invested in the UI components** in `claude-interface`. These will be migrated:

### Chat Components (`src/features/chat/`)
- `ChatMessages.tsx` - Message list with user/assistant rendering
- `ChatInput.tsx` - Prompt input with submit handling
- `ChatContainer.tsx` - Main chat layout

### Agent Activity Components (`src/features/chat/components/agent-activity/`)
- `AgentActivity.tsx` - Collapsible activity panel showing agent's work
- `AgentActivityHeader.tsx` - Header with working indicator and timing
- `AgentActivityTool.tsx` - Individual tool call cards with expand/collapse
- `AgentActivityText.tsx` - Thinking/reasoning text blocks

### AI Elements (`src/features/chat/components/ai-elements/`)
- `message.tsx` - Message bubble components
- `conversation.tsx` - Scrollable conversation container
- `loader.tsx` - Streaming indicator
- `prompt-input.tsx` - Input field components

### Shared UI (`src/features/shared/components/ui/`)
- Button, Input, Dialog, Card, etc. (shadcn/ui based)

### Layout Components (`src/features/shared/components/layout/`)
- AppLayout, AppHeader, Sidebars, TitleBar

## Migration Phases

### Phase 1: UI Shell (Current)
**Status: In Progress**

- [x] Initialize project with bun
- [x] Set up the desktop shell
- [x] Build core app layout (title bar, sidebars, main content)
- [x] Add system theme handling
- [ ] Wire up initial chat UI components

**Goal**: Establish the desktop UI shell before agent runtime integration.

### Phase 2: Agent Runtime Integration
**Status: Not Started**

1. Choose or implement the agent runtime (OpenCode server or custom)
2. Define a runtime adapter API (`sendPrompt`, `streamEvents`, `permissions`)
3. Wire the adapter into React state and chat components
4. Implement persistence for sessions and messages

### Phase 4: Migrate UI Components
**Status: Not Started**

1. Copy shared UI components from claude-interface
2. Copy chat components
3. Adapt types to match the chosen agent runtime format
4. Wire up to agent runtime hooks/adapters

### Phase 5: Permission UI
**Status: Not Started**

Define a permission request flow in the UI that the agent runtime adapter can invoke (approval/deny + optional edit). Migrate the existing `PermissionCard` component to match the new adapter API.

### Phase 6: Polish & Cleanup
**Status: Not Started**

- Remove `claude-interface` project (or archive it)
- Final testing of all features
- Performance optimization
- Error handling improvements

## Files to Delete from claude-interface

After migration is complete:
- `src/features/acp/` - TypeScript ACP implementation (already deleted)

## Testing Checklist

Before considering migration complete:

- [ ] Can send prompts and receive responses
- [ ] Tool calls display correctly in AgentActivity
- [ ] Permission prompts appear and work
- [ ] Sessions persist across app restarts
- [ ] Streaming updates show in real-time
- [ ] Subagent (Task) tool works
- [ ] Web search/fetch tools work
- [ ] File read/write/edit tools work
- [ ] Error states handled gracefully
- [ ] App performance is acceptable

## Resources

- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [React Documentation](https://react.dev/)

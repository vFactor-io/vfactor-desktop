# Chat Feature

## Learnings

- Startup restore must beat any chat mutation or persist path. If `loadSessionsForProject()`, `openDraftSession()`, `createSession()`, or `_persistState()` run before `initialize()` finishes, `chat.json` can be overwritten with an empty worktree bucket and restored tabs from `tabs.json` will point at missing sessions.
- Treat the persisted `chat.json` and `tabs.json` as a coupled restore path: empty chat state with surviving chat tabs is usually a persistence-order bug in the chat store, not a tab-reconciliation bug in `MainContent`.
- `runtime/codexTurnTracker.ts` is the main smooth-streaming choke point. For Codex turns, prefer coalescing delta-driven `onUpdate` snapshots to at most one UI commit per animation frame instead of either suppressing deltas entirely or emitting one store update per token.
- `components/ChatMessages.tsx` uses `@legendapp/list` for the chat timeline. Keep `initialScrollAtEnd`, `maintainScrollAtEnd`, `maintainScrollAtEndThreshold={0.1}`, and `maintainVisibleContentPosition` together so the transcript stays pinned while streaming and preserves visible content when the user scrolls upward.
- Treat the scroll-to-bottom button as derived list state, not a manual scroll listener heuristic. Read `LegendList` state (`isAtEnd` / `isAtStart`), debounce the detached button briefly, and scroll to end before optimistic user/assistant inserts.

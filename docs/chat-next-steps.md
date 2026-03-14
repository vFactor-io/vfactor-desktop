# Chat Next Steps

This document tracks the major chat and composer work that is still incomplete after the recent prompt-mode, Lexical, and sidebar/status work.

## Current State

The chat stack is in a much better place than before:

- the composer has a real extraction boundary under `src/features/chat/components/composer/`
- runtime-driven prompt mode is wired through the adapter, store, and composer
- skill chips work in the Lexical composer
- optimistic first-message thread creation avoids the earlier empty delay
- prompt-aware sidebar/thread status is in place

What remains is mostly about finishing the architecture rather than patching isolated UI bugs.

## Main Incomplete Areas

### 1. Prompt Flows Beyond Structured Questions

Structured runtime prompts are now supported for:

- `single_select`
- `multi_select`
- `text`

Still missing:

- approvals/review flows
- richer interrupt-style agent requests
- broader harness parity beyond the current prompt path

### 2. Composer Model Is Still Partial

The Lexical composer is currently scoped to skill chips only.

Still missing:

- file chips
- agent mentions as first-class entities
- richer inline entities/tokens
- a more complete parse/serialize model for all composer entities

### 3. Files Are Not Yet First-Class Chat References

The file tree exists, but files are not yet integrated into the composer as proper structured references.

Still needed:

- insert file references as chips/entities
- serialize file references cleanly for the harness
- unify file references with the same interaction model as skills

### 4. Timeline Normalization Is Not Finished

A lot of meaning is still inferred too close to render time.

Still needed:

- a normalized timeline row/block model
- clearer separation between adapter events, store state, and UI render shapes
- less ad hoc branching inside timeline rendering

### 5. Performance Work Is Still Pending

Performance needs to be treated as a backbone concern for chat.

Still needed:

- timeline virtualization
- batched/coalesced streaming updates
- stronger isolation between composer renders and timeline renders
- profiling long threads and heavy activity timelines

### 6. Skills and Automations Are Still Mostly UI Surfaces

Both pages have been moved much closer to the desired product direction, but they are still mostly demo/design surfaces rather than fully wired product flows.

Still needed:

- real data wiring
- real actions
- persistence/runtime integration

## Recommended Order

The current recommended implementation order is:

1. Finish runtime-driven interruption flows beyond basic structured prompts.
2. Expand the Lexical composer beyond skill chips.
3. Add file references as first-class composer entities.
4. Normalize timeline rows/blocks before more UI complexity is added.
5. Do the dedicated performance pass:
   - virtualization
   - batched streaming updates
   - render isolation
6. Fully wire skills and automations to real runtime data.

## Notes

- Keep provider-specific behavior inside harness adapters.
- Extend the existing `composer/`, `domain/`, and `store/` seams instead of creating parallel refactor structures.
- Treat chat performance as an architectural requirement, not a later polish task.

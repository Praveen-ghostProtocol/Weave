# Implementation Plan: Weave v0

## Overview
Weave v0 is a static, client-only Next.js app: the user builds a graph of
"persona" nodes (title, domain tag, markdown body), links them, views the
graph with manual layout (react-flow), and exports a selection (plus their
one-hop neighbors) as a copy-pasteable markdown block. Everything persists
to IndexedDB via Dexie in the browser — no backend, no auth. This plan
covers scaffolding through deployment for that v0 scope only.

## Architecture Decisions
- **Graph operations are pure functions over a `PersonaGraph` value**
  (`lib/graph/*.ts`), independent of storage — matches the spec's own code
  sample (`linkNodes(graph, fromId, toId)`). This lets link/unlink/delete/export
  logic be written and unit-tested before (and in parallel with) the Dexie
  wrapper exists, and keeps the hardest-to-get-right logic (dedup, cascade
  delete, one-hop export) framework-free and easy to test.
- **Storage is a thin Dexie wrapper** (`lib/storage/db.ts`) that loads the
  whole graph into memory on mount and persists on change — the spec expects
  tens of nodes per user, not hundreds, so there's no need for incremental
  queries or pagination in v0.
- **One shared client-side graph state container** (a hook/context built in
  the app-shell task) is the single source of truth the node editor, graph
  view, and export panel all read/write — avoids three components each
  reinventing load/save logic against Dexie.
- **react-flow handles rendering and drag positions only**; linking,
  unlinking, and deletion stay in the pure `lib/graph` functions, called from
  UI event handlers. react-flow is not the source of truth for graph data.
- Node editor and export panel are separate components from the graph
  canvas, so they can be built in parallel once the app shell/state
  container exists (Phase 3).

## Dependency Graph

```
Scaffold (Next.js+TS+Tailwind)
    │
Test tooling + deps (vitest, playwright, dexie, reactflow)
    │
Core types (lib/graph/types.ts)
    │
    ├── Dexie storage wrapper ────────────┐
    ├── link/unlink pure fns              │
    ├── delete-node cascade               │  (these 4 can be built in
    └── neighbor lookup + export format   │   parallel by different
                                           │   sessions — independent files,
                                           │   only shared dependency is
                                           │   the types from above)
    │
  [Checkpoint A: unit tests pass]
    │
App shell + shared graph state container
    │
    ├── Empty-state UI
    │
    ├── Node editor component  ───┐
    ├── Graph view (react-flow)   │ (parallel once app shell/state
    │     └── link/unlink UI      │  container exists — separate
    └── Export panel component ───┘  components, same shared state)
    │
  [Checkpoint B: manual full-loop test]
    │
Playwright e2e critical-path test
    │
Fresh-visitor / empty-state QA pass
    │
Deploy to Vercel
    │
  [Checkpoint C: success criteria + deploy verified]
```

## Parallelization
- **Safe to parallelize:** the four `lib/graph`/`lib/storage` foundation
  tasks (storage wrapper, link/unlink, delete cascade, export/neighbor
  logic) once types exist — they touch disjoint files and only read the
  shared type definitions. Likewise node editor, graph view, and export
  panel can proceed in parallel once the app shell's state container exists.
- **Must be sequential:** scaffold → test tooling → types (nothing else can
  start first); app shell/state container before any UI component (they all
  depend on it); all UI components before the e2e test (it drives the full
  integrated app); deploy last.
- **Needs coordination:** the shared graph-state container's shape (what
  hooks/functions it exposes for read/update/subscribe) should be settled
  before node editor / graph view / export panel tasks start in parallel,
  since all three call into it.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Dexie/IndexedDB access during Next.js SSR or build (`window`/`indexedDB` undefined on the server) | High — build or dev-server crashes | Keep all Dexie access behind `"use client"` components, guard with `typeof window !== "undefined"`, and lazy-init the Dexie instance inside the state hook, not at module load time. Verify with `npm run build` early (Checkpoint A/B), not just `npm run dev`. |
| react-flow manual-layout + position persistence has a learning curve (debouncing drag events, saving `x,y` back to Dexie without thrashing) | Medium — could blow the "one session" budget for the graph-view task | Scope the graph-view task to rendering + position persistence only; push link/unlink *interaction* (drag-to-connect, delete-edge) into its own follow-on task (see Task 12) so a stuck react-flow integration doesn't block the rest of the UI. |
| Edge dedup / cascade-delete logic has subtle bugs (e.g. deleting a node leaving a dangling edge, or A→B / B→A both getting stored) | High — violates an explicit Graph & Export Semantics rule and a Success Criterion | These are pure functions with no UI — write unit tests in the same task per the spec's testing strategy, before any UI consumes them (Checkpoint A gates on this). |
| "One-hop neighbor" export logic silently drops a node or double-includes content when a selected node is also a neighbor of another selected node | Medium — exported context could be wrong or duplicated, undermining the one thing v0 is meant to validate | Dedup the final node set (selected ∪ neighbors) by id before formatting; cover with a unit test where two selected nodes share a neighbor. |
| Vercel deploy of a client-only app with no server data needs no special config, but a missed `"use client"` boundary could make the build fail only in production (`next build`), not `next dev` | Medium — surprise at deploy time | Run `npm run build` locally as part of Checkpoint B/C, not just before deploying. |
| Scope creep into v1 concerns (accounts, sync, real privacy/deletion design) | Medium — wasted effort, spec explicitly defers this | Plan has no tasks referencing backend/auth/DB; any such suggestion during implementation should be flagged against the spec's "Ask first" boundary, not built. |

## Verification Checkpoints
- **Checkpoint A** (after Tasks 3–7): `npm test` passes for all `lib/graph`
  and `lib/storage` unit tests; `npm run build` succeeds; no UI exists yet,
  this gates on logic correctness alone.
- **Checkpoint B** (after Tasks 8–13): full manual walkthrough — open app
  fresh (empty state), create two nodes, link them, see both in graph view
  with positions persisting across a reload, export with one node selected
  and confirm the neighbor is included, confirm export is disabled at zero
  selection. `npm test` and `npm run build` both still pass.
- **Checkpoint C** (after Tasks 14–16): `npx playwright test` passes for the
  critical-path e2e spec; every Success Criteria checkbox in SPEC.md is
  verified; app is reachable at a public Vercel URL and renders correctly
  for a first-time visitor with zero existing data.

## Open Questions
1. **(From SPEC.md, still open)** At what point (node count, session count,
   user feedback) is the core loop considered "validated" enough to start v1
   (accounts/backend)? Not blocking v0 build. Suggested default unless
   overridden: the founder personally builds 5+ linked nodes across 2+
   domains and still finds the export useful two weeks later — record the
   final answer in SPEC.md before Checkpoint C.
2. **Domain tag — resolved: free-form string.** Node editor offers
   autocomplete from previously-used tags (not a closed dropdown). Lower
   risk, matches the spec's own loosely-defined examples.
3. **Link-creation interaction — resolved: react-flow native drag-from-handle.**
   Least code (library default), matches how graph UIs conventionally work;
   no separate "Link" button needed.
4. **Export selection UX — resolved: checkbox list in a sidebar**, not
   canvas multi-select, for v0. Simpler to build and test; canvas
   multi-select can be added later if the checkbox list proves clunky.
5. **Known gap, deferred, not silently skipped: narrow-viewport layout.**
   DESIGN.md §4 calls for only one panel (export sidebar / node editor)
   open at a time on narrow viewports; the current integration always
   shows the export sidebar and the node editor itself is a fixed 420px
   panel with zero responsive handling (overflows a ~375-414px viewport
   outright). SPEC.md's Success Criteria don't mention mobile, so this
   isn't blocking Checkpoint B/C, but it's a real DESIGN.md compliance
   gap, not a hypothetical — needs its own small task before calling v0
   polished: responsive widths on NodeEditor/ExportPanel plus hiding the
   export sidebar while the editor is open on narrow screens.
6. **Known gap, deferred: e2e test is dev-mode + Chromium-only.**
   `critical-path.spec.ts` runs against `npm run dev` (Turbopack dev
   server, not a production build) and only Chromium (no `projects` array
   for Firefox/WebKit). Red-team flagged this as a truth-in-labeling gap,
   not an active flake risk — the "critical path passes" claim is narrower
   than it sounds. Not blocking Checkpoint C; worth broadening once v0 has
   real usage to justify the CI time.

Only #1 is still genuinely open and doesn't block any task.

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
5. **Narrow-viewport layout — partially fixed.** product-manager's final
   design review caught that the export sidebar was a *permanent* standing
   column, which violates DESIGN.md §4's "never a third column that
   permanently shrinks the canvas" outright (not just a narrow-viewport
   nicety). Fixed: export sidebar is now a toggleable overlay panel like
   the node editor, and opening one force-closes the other below a 768px
   viewport. Remaining, still deferred and tracked: NodeEditor (420px) and
   ExportPanel (320px) are both fixed-width with no responsive sizing, so
   either can still overflow a ~375-414px phone viewport on its own. Not
   blocking Checkpoint C (SPEC.md's Success Criteria don't cover mobile).
6. **Known gap, deferred: e2e test is dev-mode + Chromium-only.**
   `critical-path.spec.ts` runs against `npm run dev` (Turbopack dev
   server, not a production build) and only Chromium (no `projects` array
   for Firefox/WebKit). Red-team flagged this as a truth-in-labeling gap,
   not an active flake risk — the "critical path passes" claim is narrower
   than it sounds. Not blocking Checkpoint C; worth broadening once v0 has
   real usage to justify the CI time.

Only #1 is still genuinely open and doesn't block any task.
7. **Known gap, deferred: "Select all"/"Select none" contrast.** Flagged by
   product-manager during Phase 5's design review — pre-existing (predates
   AI draft assist), low-severity, worth a DESIGN.md §7 contrast check in
   dark mode before calling the export sidebar fully polished. Not blocking
   any checkpoint.

## Phase 5: AI draft assist — architecture & risk

### CORS / direct-browser-access (checked for real, not assumed)
This was flagged as a potential blocker before any task was written, because
if Anthropic's API required a server-side caller, SPEC.md's "no backend,
BYOK, direct browser fetch" premise would be wrong and the whole approach
would need rethinking. Checked against the current official docs
(`platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript`) and a
corroborating find (Simon Willison, Aug 2024, on the TypeScript SDK's PR
history):

- **Direct browser calls to `api.anthropic.com` are supported.** They are
  blocked by CORS *unless* the request includes the header
  `anthropic-dangerous-direct-browser-access: true`. With that header
  present, the preflight passes and the call succeeds.
- The TypeScript SDK's own browser gate (`dangerouslyAllowBrowser`) exists
  for the same reason the header is named "dangerous": a key embedded in
  client code is extractable by anyone with page access. Anthropic's own
  docs call out exactly this product's shape as a case where that's an
  acceptable tradeoff — "internal tools" and bring-your-own-key setups
  where the exposed credential is the *user's own*, not the developer's.
  That's this feature exactly: the user supplies their own key, it's used
  only for their own requests, stored only in their own browser.
- **Conclusion: the approach is sound, no backend/proxy needed.** We don't
  need the `@anthropic-ai/sdk` package for this (ponytail: one endpoint,
  one `fetch` call, per SPEC.md's own Tech Stack entry) — just a raw
  `fetch` to `https://api.anthropic.com/v1/messages` with `x-api-key`,
  `anthropic-version`, and the dangerous-access header set.

### Where the fetch call lives
`lib/llm/anthropic.ts` — a standalone function (`draftContext(markdown,
apiKey)`), not a class, not a client object with config state (nothing here
needs to persist between calls). Pure aside from the network call itself:
takes the key and content as arguments, returns text or throws a typed
error. No `localStorage` access inside this module — keeps it unit-testable
with a mocked `fetch` and keeps "the key touches `localStorage` in exactly
one place" true, which matters for the never-log/never-leak boundary in
SPEC.md. Mirrors how `lib/graph/export.ts` stays framework-free and
testable.

### API key handling
- `type="password"` on the input (DESIGN.md's accessibility note) — doesn't
  stop a browser extension or devtools inspection, but it's the baseline
  browser affordance against shoulder-surfing and this is otherwise a
  prominently browser-side-stored secret by design (SPEC.md's own choice,
  not a gap to fix here).
- One `localStorage` key, read at call time, never held in React state
  longer than the input's own controlled-value lifetime — avoids the key
  sitting in a component's state tree (and React DevTools) any longer than
  necessary.
- Never passed to `console.*`, never included in a thrown error's message
  (errors from Task 18 describe the *failure kind*, not request contents).

### Risks and mitigations (additive to the table above)
| Risk | Impact | Mitigation |
|------|--------|------------|
| `anthropic-dangerous-direct-browser-access` is an unversioned, lightly-documented header (found via SDK source/community write-ups, not a prominent docs page) — Anthropic could change its behavior | Medium — draft assist breaks for all users at once if so | Isolated in one module (`lib/llm/anthropic.ts`); a change surfaces as one failing unit test + one place to fix, not a scattered rewrite. |
| User pastes a key with leading/trailing whitespace or a non-`sk-ant-...` string | Low — confusing 401 | `apiKey.ts`'s `setApiKey` trims input; the fetch client's 401 path shows "invalid key," not a generic error, so the failure is at least legible. |
| Rate limiting / cost: a user's own key, their own usage and bill — not Weave's cost | None for us | No action needed; worth a one-line mention in the settings row's helper text if it gets confusing in practice, not blocking. |
| Someone treats the exposed-key tradeoff as acceptable for a key that *isn't* their own (e.g. a shared/team key pasted into a personal browser) | Medium — SPEC.md's safety argument assumes a personal key | Out of this feature's control; the settings row's copy ("Stored only in this browser") is the honest disclosure, same spirit as Anthropic's own browser-support docs. |

### Open Questions (Phase 5)
None blocking. The one thing that could have blocked this phase (CORS /
direct-browser feasibility) is resolved above.

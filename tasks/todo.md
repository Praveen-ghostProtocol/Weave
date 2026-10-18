# Weave v0 — Task List

Ordered by dependency, not importance. See `tasks/plan.md` for the full
dependency graph, risks, and open questions. Open Questions 2–4 there
should be answered before Tasks 10, 12, and 13 respectively.

## Phase 0: Scaffold

- [x] Task: Scaffold Next.js (App Router) + TypeScript + Tailwind app
  - Acceptance: `npx create-next-app` (TS, Tailwind, App Router, ESLint)
    produces a running app; default page replaced with a placeholder "Weave"
    page; project structure matches SPEC.md (`app/`, `components/`,
    `lib/graph/`, `lib/storage/`, `tests/`, `e2e/` directories exist, empty
    ones via `.gitkeep`).
  - Verify: `npm run dev` serves the placeholder page without errors;
    `npm run build` succeeds.
  - Files: `package.json`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`
    (note: Tailwind v4 config lives in `app/globals.css` via `@theme`, no
    `tailwind.config.ts` — ponytail call, nothing for that file to do)

- [x] Task: Add test tooling and core libraries
  - Acceptance: Vitest configured and runs an example passing test; Playwright
    installed and configured (browser installed); `dexie`, `reactflow`, and
    `@phosphor-icons/react` added as dependencies (per DESIGN.md's resolved
    icon-library choice — regular weight only, no duotone/fill).
  - Verify: `npm test` runs and passes a trivial sample test; `npx playwright
    test` runs (even with zero specs) without a config error.
  - Files: `vitest.config.ts`, `playwright.config.ts`, `package.json`,
    `tests/sample.test.ts`

## Phase 1: Data model & graph logic (foundation)

- [x] Task: Define core graph types
  - Acceptance: `PersonaNode` (id, title, domain, markdown body, position),
    `PersonaEdge` (fromId, toId), and `PersonaGraph` (nodes, edges) types
    defined and exported; `DomainTag` typed per Open Question 2's resolution
    (string or union — default to `string` if unresolved).
  - Verify: `npm run build` succeeds (type-checks); no runtime behavior to
    test (trivial types excluded per spec's testing strategy).
  - Files: `lib/graph/types.ts`
  - Dependencies: Task 1

- [x] Task: Link and unlink pure functions
  - Acceptance: `linkNodes(graph, fromId, toId)` adds an undirected, deduped
    edge (matches SPEC.md's own example); relinking an existing pair (either
    direction) is a no-op; `unlinkNodes(graph, fromId, toId)` removes the
    edge regardless of stored direction; self-links throw.
  - Verify: `npm test` — unit tests cover: new link added, duplicate link
    (same direction) no-ops, duplicate link (reverse direction) no-ops,
    unlink removes edge, self-link throws.
  - Files: `lib/graph/linkNodes.ts`, `lib/graph/unlinkNodes.ts`,
    `tests/linkNodes.test.ts`, `tests/unlinkNodes.test.ts`
  - Dependencies: Task 3

- [x] Task: Delete-node cascade
  - Acceptance: `deleteNode(graph, nodeId)` removes the node and every edge
    referencing it (from either side); deleting a non-existent id is a no-op
    or throws (pick one, document in a comment).
  - Verify: `npm test` — unit test creates a node with two edges, deletes it,
    asserts both edges are gone and no dangling edge references remain.
  - Files: `lib/graph/deleteNode.ts`, `tests/deleteNode.test.ts`
  - Dependencies: Task 3

- [x] Task: Neighbor lookup and export formatting
  - Acceptance: `getNeighbors(graph, nodeId)` returns directly-linked nodes
    (one hop); `exportContext(graph, selectedIds)` returns a markdown string
    containing the full content of every selected node plus its one-hop
    neighbors, deduped by id (a node selected twice, or selected and also a
    neighbor of another selection, appears once); also returns a
    character/token-estimate count alongside the markdown; exporting an
    empty selection returns an empty/null result rather than throwing (UI
    enforces the "disabled at zero selection" rule separately — see Task 13).
  - Verify: `npm test` — unit tests cover: single node export includes its
    neighbor, two selected nodes sharing a neighbor include that neighbor
    once, estimate count is present and non-zero for non-empty export.
  - Files: `lib/graph/export.ts`, `tests/export.test.ts`
  - Dependencies: Task 3

### Checkpoint A — Foundation
- [x] `npm test` passes for all Phase 1 tests
- [x] `npm run build` succeeds
- [x] Review graph-logic correctness against Graph & Export Semantics in
      SPEC.md before starting any UI work

## Phase 2: App shell & state

- [x] Task: App shell with shared graph state container
  - Acceptance: A client-side hook/context (e.g. `useGraph`) loads the graph
    from Dexie on mount and exposes read access plus functions to add/update/
    delete nodes and link/unlink edges, persisting each change back to
    IndexedDB; root layout and home page wire this in; no SSR/build crash
    from IndexedDB access (guarded behind `"use client"` / `typeof window`
    checks per plan.md's top risk).
  - Verify: `npm run build` succeeds; manual check — open app in browser,
    create a node via a temporary debug call (or minimal inline form),
    reload the page, confirm the node persisted.
  - Files: `lib/storage/db.ts`, `lib/storage/useGraph.tsx` (JSX Provider,
    not `.ts` — React Compiler's ref-safety lint rule flags `createElement`),
    `app/layout.tsx`, `app/page.tsx`
  - Dependencies: Task 3, Checkpoint A

- [x] Task: Empty-state UI
  - Acceptance: With zero nodes, the home page shows an empty-state message
    and a clear call-to-action to create the first node, instead of a blank
    or broken canvas.
  - Verify: Manual check — clear IndexedDB (or use a fresh browser profile),
    load the app, confirm the empty state renders without errors.
  - Files: `app/page.tsx`, `components/EmptyState.tsx`
  - Dependencies: Task 8

## Phase 3: UI components (parallelizable after Task 8)

- [x] Task: Node editor component
  - Acceptance: Form to create a node (title, domain tag per Open Question 2,
    markdown body) and edit an existing node; a delete action that calls the
    Task 6 cascade-delete through the shared state container; validation
    prevents saving a node with an empty title.
  - Verify: `npm test` for any extracted validation logic; manual check —
    create a node, edit it, delete it, confirm it disappears from state.
  - Files: `components/NodeEditor.tsx`
  - Dependencies: Task 8

- [x] Task: Graph view rendering and layout persistence
  - Acceptance: react-flow canvas renders all nodes and edges from shared
    state; dragging a node updates its position in state and persists to
    IndexedDB (debounced, not on every pixel of drag); a focused node also
    moves via arrow keys (larger step with Shift held), per DESIGN.md's
    resolved keyboard-accessibility requirement; clicking a node opens it in
    the node editor; reloading the page preserves the last-saved positions.
  - Verify: Manual check — add 2–3 nodes, arrange them (mouse and keyboard),
    reload, confirm positions held; click a node, confirm editor opens with
    its content.
  - Files: `components/GraphView.tsx`
  - Dependencies: Task 8

- [x] Task: Link/unlink interaction in graph view
  - Acceptance: Per Open Question 3's resolution, user can create a link
    between two nodes from the graph view (calls `linkNodes` from Task 4
    through shared state) and remove an existing link (calls `unlinkNodes`);
    the edge appears/disappears immediately in the canvas.
  - Verify: Manual check — link two nodes, confirm edge renders and persists
    across reload; remove the link, confirm it's gone from both the canvas
    and IndexedDB.
  - Files: `components/GraphView.tsx`
  - Dependencies: Task 4, Task 11

- [x] Task: Export panel component
  - Acceptance: Per Open Question 4's resolution, user can select node(s) or
    "all"; export button calls `exportContext` from Task 6, shows the running
    character/token-estimate count as selection changes, copies the result
    to the clipboard on click; export control is disabled (not erroring) when
    selection is empty.
  - Verify: Manual check — select one node, confirm its neighbor's content is
    included in the copied text; clear selection, confirm export is disabled.
  - Files: `components/ExportPanel.tsx`
  - Dependencies: Task 6, Task 8

### Checkpoint B — Full loop
- [x] Fresh load → create two nodes → link them → both visible in graph view
      with persisted positions → select one → export includes both (one-hop)
      → export disabled at zero selection
- [x] `npm test` and `npm run build` both still pass

## Phase 4: Testing, polish, deploy

- [x] Task: Playwright critical-path e2e test
  - Acceptance: Automates: create node → link two nodes → see them in graph
    view → export context → assert exported text contains both nodes'
    content. Matches the Testing Strategy's one required e2e path.
  - Verify: `npx playwright test` passes locally against `npm run dev` (or
    a built+started app).
  - Files: `e2e/critical-path.spec.ts`
  - Dependencies: Checkpoint B

- [x] Task: Fresh-visitor / empty-state QA pass
  - Acceptance: Every Success Criteria checkbox in SPEC.md verified by hand
    against a cleared-storage browser profile; any bug found is fixed in its
    owning file (no new files expected; if one is needed, it belongs to
    whichever Phase 1–3 task owns that logic).
  - Verify: Manual check-off of each SPEC.md Success Criteria line item.
  - Files: (fixes only, as needed — no new files expected)
  - Dependencies: Task 14

- [x] Task: Deploy to Vercel
  - Acceptance: App builds and deploys on Vercel as a static/client app (no
    DB/server env needed); public URL loads correctly for a first-time
    visitor with zero existing data (empty state, no console errors).
  - Verify: Visit the deployed URL in a private/incognito window, confirm
    empty state renders and the full create → link → export loop works.
  - Files: (deploy config only if needed, e.g. `vercel.json`)
  - Dependencies: Task 15

### Checkpoint C — Ship
- [x] All SPEC.md Success Criteria checked off
- [x] `npx playwright test` passes
- [x] App reachable at a public Vercel URL, verified with zero existing data
- [x] Open Question 1 (v1 validation trigger) has a rough answer recorded
      somewhere (e.g. SPEC.md or plan.md) before calling v0 done

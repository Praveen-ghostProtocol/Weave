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

## Phase 5: AI draft assist

Confirmed before any task below was written (see plan.md's Open Questions /
Risks): direct browser calls to `api.anthropic.com` work and are officially
supported, gated behind the `anthropic-dangerous-direct-browser-access: true`
request header — this is not a backend-required feature, the SPEC.md
addendum's "no backend" premise holds.

- [x] Task: API key local storage wrapper
  - Acceptance: `getApiKey()`, `setApiKey(key)`, `clearApiKey()`, and
    `hasApiKey()` read/write a single key under one `localStorage` key name;
    `setApiKey("")` or whitespace-only is treated as clearing, not storing an
    empty string; nothing here ever calls `console.log`/`console.error` with
    the key value.
  - Verify: `npm test` — unit tests cover set → get round-trip, clear removes
    it, `hasApiKey()` reflects presence correctly, empty/whitespace input
    clears rather than stores.
  - Files: `lib/storage/apiKey.ts`, `tests/apiKey.test.ts`
  - Dependencies: None

- [x] Task: Anthropic direct-fetch client
  - Acceptance: `draftContext(markdown, apiKey)` POSTs to
    `https://api.anthropic.com/v1/messages` with headers `x-api-key`,
    `anthropic-version`, and `anthropic-dangerous-direct-browser-access:
    "true"` (required for the request to pass Anthropic's CORS check from a
    browser origin — confirmed in plan.md, not assumed); sends the export
    markdown (same content raw export would produce) as the user message
    with a system prompt asking for a concise first-person context brief;
    returns the response text on success; throws a typed error distinguishing
    at least "invalid key" (401), "rate limited" (429), and "network/other"
    so the UI can show a specific message, per SPEC.md's addendum success
    criteria. Pure function aside from the `fetch` call — no DOM, no
    `localStorage` access inside this module (caller passes the key in).
  - Verify: `npm test` — unit tests mock `fetch` and cover: success path
    returns the text, 401 throws the "invalid key" variant, 429 throws the
    "rate limited" variant, a rejected/thrown fetch (network failure) throws
    the "network" variant.
  - Files: `lib/llm/anthropic.ts`, `tests/anthropic.test.ts`
  - Dependencies: None

- [x] Task: Settings affordance (API key UI) in the export sidebar
  - Acceptance: Per DESIGN.md's "Export sidebar — AI draft assist" section —
    a ghost icon button (ink-muted when no key, accent-tinted when a key is
    set, with a text-equivalent `aria-label`/`title` for the status, not
    color alone) in the sticky header toggles an inline row with a labeled
    `type="password"` input, "Save", and "Clear"; Save persists via Task 17
    and collapses the row; the row never renders the stored key value back
    into a visible/plaintext state beyond normal password-field behavior.
  - Verify: Manual check — open the row, enter a key, save, reload the page,
    confirm the icon shows "key set" status and the row is collapsed by
    default; clear the key, confirm status reverts.
  - Files: `components/ExportPanel.tsx`
  - Dependencies: Task 17

- [x] Task: "Draft with AI" action and result display
  - Acceptance: Per DESIGN.md — a second, secondary-styled button below
    "Export selection", same disabled-at-zero-selection treatment; clicking
    with no key stored expands/focuses the Task 19 settings row instead of
    calling the API (no silent no-op); clicking with a key present calls
    Task 18's `draftContext` with the same markdown `exportContext` (lib/
    graph/export.ts) would produce for the current selection; shows
    "Drafting…" (button disabled, no spinner) while in flight; on success,
    renders the result block above the footer (label, "Copy" button, "×"
    dismiss, read-only scrollable text) per DESIGN.md; on error, button
    shows "Draft failed — try again" with `--danger` border and an inline,
    `aria-live` error line naming which failure it was (bad key / rate
    limit / network); dismissing the result clears it without touching the
    current node selection; raw "Export selection" continues to work
    unchanged regardless of AI draft assist's state (additive, never a
    replacement, per SPEC.md).
  - Verify: Manual check — with no key: click "Draft with AI", confirm
    settings row opens instead of a request firing. With a key: draft a
    selection, confirm result text appears and "Copy" copies it; dismiss and
    confirm checkbox list / raw export still work. Force an error path
    (e.g. temporarily invalid key) and confirm the specific inline error
    text appears, not a crash or silent failure.
  - Files: `components/ExportPanel.tsx`
  - Dependencies: Task 18, Task 19

### Checkpoint D — AI draft assist
- [x] `npm test` passes (Tasks 17–18's unit tests)
- [x] `npm run build` succeeds
- [x] All five "AI draft assist (addendum)" Success Criteria checkboxes in
      SPEC.md verified by hand: key persists across reload; raw export works
      with zero setup; drafting with a key shows a synthesized brief;
      no-key click shows an inline prompt, not a no-op; a forced API error
      shows a clear inline error, not a silent failure
- [x] product-manager design review against DESIGN.md's AI draft assist
      section before calling this phase done

## Phase 6: Slice 1 — public launch (platform-backend + auth + llm-proxy)

Scope is SPEC.md's "Slice 1" only. The capability map in `tasks/plan.md`
covers everything deferred past it; nothing from that list gets built here
without its own spec and go-ahead (SPEC.md Boundaries, "Ask first").

Most of Slice 1's code already landed across three commits. What remains is
one correctness fix, two decisions, a doc cleanup, and a verification pass
that can only run against a live signed-in session — which is why the ten
Slice 1 Success Criteria in SPEC.md are all still unchecked.

- [x] Task: Retire BYOK, point "Draft with AI" at the server proxy
  - Acceptance: `ExportPanel` POSTs `{ markdown }` to
    `/api/ai/draft-brief` instead of calling Anthropic; the API-key input,
    Save/Clear buttons and `Key` header icon are gone; a signed-out click
    shows an inline sign-in prompt and fires no request (button keeps its
    normal styling, per DESIGN.md's "No key set" rule — a discoverable
    state, not a failure); a 401 mid-session shows that same prompt; every
    other failure shows the server's own `error` string; raw export still
    works signed out. `lib/llm/anthropic.ts`, `lib/storage/apiKey.ts` and
    their tests deleted (no remaining importers).
  - Verify: `npm test`, `npm run lint`, `npm run build` all pass; in a
    browser, signed out, confirm no `/api/ai/draft-brief` request fires and
    the prompt renders. DONE — verified 2026-10-20.
  - Files: `components/ExportPanel.tsx`, plus four deletions
  - Dependencies: none

- [x] Task: Close the per-user quota race in the draft-brief route
  - Why: SPEC.md's Success Criteria claims "concurrent requests from one
    user can't together exceed their quota." The route does not currently
    deliver that. It reads daily and monthly spend, *then* inserts the
    reservation as a separate statement — two concurrent requests both read
    a pre-reservation total, both pass the cap check, and both proceed.
    Reserve-then-settle closes the race only when the check and the insert
    are atomic. Worst case per call is roughly $0.016 (15k input plus 1024
    output at mini pricing), so a burst of N concurrent requests can
    reserve about $0.016N against a $0.05/day cap.
  - Acceptance: the cap check becomes atomic with the reservation. Reserve
    FIRST, then re-read the scoped total (which now includes this
    reservation, since `getDailySpend` and `getMonthlySpend` both count
    `reserved` rows), and if the total exceeds the cap, refund the
    reservation and return 429 without calling OpenAI. Two concurrent
    requests that together fit under the cap both proceed; two that don't
    are both rejected and both refunded. Over-rejection is acceptable,
    overspend is not. No new migration and no stored procedure — reuses the
    existing `reserve`/`refund` pair.
  - Verify: `npm test` — unit tests cover an under-cap request proceeding,
    a reservation that pushes the total over the cap being refunded and
    429ing, and the refund actually firing on that path.
    DONE — verified 2026-10-20. `tests/draftBrief.route.test.ts` adds 10
    cases, including an explicit ordering assertion that `reserve` is
    invoked before any cap read (that assertion IS the fix; if it ever
    flips, the race is back). Needed one piece of infrastructure: vitest
    doesn't read tsconfig paths, so `vitest.config.mts` now mirrors the
    `@/*` alias.
  - Files: `app/api/ai/draft-brief/route.ts`,
    `tests/draftBrief.route.test.ts`, `vitest.config.mts`
  - Dependencies: none

- [x] Task: Ratify the per-user cap numbers
  - Why: `DAILY_USER_CAP_USD` at $0.05 and `MONTHLY_USER_CAP_USD` at $0.25
    are hardcoded in the route and appear in neither SPEC.md nor plan.md.
    plan.md commits to "per-user daily/monthly dollar quotas" without
    figures. SPEC.md lists quota changes under "Ask first," so these are
    an unratified guess sitting in the money path.
  - Acceptance: the founder confirms or changes both numbers, and the
    agreed values are written into SPEC.md's Slice 1 spend-controls section
    so the code implements a decision rather than defining one.
  - Note: the nano switch below changed what these buy. Worst case per call
    is now about $0.0043 (15k input at $0.20/M plus 1024 output at
    $1.25/M), down from about $0.016 on mini. So $0.05/day is roughly 11
    calls and $0.25/month is roughly 58 — decide against those numbers, not
    the old ones.
    DONE — 2026-10-20. Founder kept both numbers as they stand. Written
    into SPEC.md's Slice 1 spend-controls block, alongside a note that the
    two constants and the spec must change together.
  - Verify: the two constants in the route match the two numbers in
    SPEC.md.
  - Files: `SPEC.md`, `app/api/ai/draft-brief/route.ts`
  - Dependencies: none, but blocks Checkpoint E

- [x] Task: Switch draft-brief to the cheapest model
  - Why: founder's explicit call on 2026-10-20 — keep running cost as low
    as possible.
  - Acceptance: `MODEL` is `gpt-5.4-nano`, and `PRICE_PER_MILLION_INPUT`
    and `PRICE_PER_MILLION_OUTPUT` move with it ($0.20 and $1.25). These
    three MUST change together: `lib/llm/budget.ts` reserves and settles
    against the price constants, so a model swap without a price swap
    silently mis-bills the ledger and every cap derived from it.
  - Verify: `npm test` — the request-shape test now asserts against the
    exported `MODEL` constant rather than a hardcoded literal, so a
    deliberate swap stops reading as a test failure. DONE — 2026-10-20.
  - Files: `lib/llm/openai.ts`, `tests/openai.test.ts`

- [x] Task: Amend SPEC.md's model-routing rule to match the nano switch
  - Why: SPEC.md's Tech Stack says "`gpt-5.4-nano` for structured/cheap
    tasks, `gpt-5.4-mini` for prose." `draft-brief` writes prose and now
    runs on nano, so the code and the spec disagree. One of them has to
    move, and the founder has already chosen the code's side.
  - Acceptance: the Tech Stack line reflects nano-first with mini as the
    escape hatch if brief quality proves too weak; the reasoning is
    recorded so a later reader doesn't "fix" it back to mini.
  - Verify: no routing rule in SPEC.md contradicts `MODEL`.
    DONE — 2026-10-20. Tech Stack now reads nano-first for every task
    including prose, with mini as the per-task escape hatch, and says
    outright that this is the decision rather than an oversight.
  - Files: `SPEC.md`
  - Dependencies: none, but pairs with the quality judgement in the live
    AI draft happy-path verification below

- [x] Task: Retire BYOK from the written record
  - Acceptance: SPEC.md's "AI draft assist (addendum)" no longer describes
    the Anthropic key path as live — it currently says "still live until
    the replacement ships," and the replacement has now shipped. Its five
    addendum Success Criteria are either struck or restated against the
    proxy. DESIGN.md's "API key — a settings affordance" bullet and the
    `Key` icon spec are removed, and its "No key set" bullet is restated as
    the signed-out case. The Tech Stack BYOK line is marked retired.
  - Verify: no doc describes a UI element that no longer exists; grepping
    for "Anthropic API key" returns nothing outside historical-record prose.
    DONE — 2026-10-20. SPEC.md's addendum is marked retired and its five
    criteria struck or restated; the Tech Stack BYOK line is struck;
    Graph & Export Semantics now describes the proxy. DESIGN.md's key
    affordance and its a11y note are replaced, and "No key set" is
    restated as "Signed out". Two stale code comments pointing at the
    deleted files were fixed too.
  - Files: `SPEC.md`, `DESIGN.md`
  - Dependencies: the rewire task above, which is done
  - Note: these sections are ceo- and product-manager-owned. This task is
    cleanup to match shipped reality, not a scope change.

- [x] Task: Live auth verification pass
  - Acceptance: against a real Supabase project with Google OAuth
    configured — sign-in with Google succeeds, the session survives a
    reload, sign-out works, and a signed-out visitor still gets the full v0
    app (local graph, create, link, export, zero setup, no AI).
  - Verify: manual, in a browser. Covers SPEC.md Slice 1 criteria 1 and 2.
  - Files: none; verification only, and any fix lands in its owning file
  - Dependencies: `.env.local` populated, migration applied

- [x] Task: Live AI draft happy-path verification
  - Acceptance: signed in, with no API key anywhere in the browser,
    "Draft with AI" returns a synthesized first-person brief; the result
    block renders with Copy and dismiss; dismissing leaves the selection
    intact; raw export still works alongside it.
  - Verify: manual. Covers SPEC.md Slice 1 criterion 3.
  - Dependencies: live auth verification

- [x] Task: Live spend-control verification
  - Acceptance: with the per-user caps temporarily lowered to a near-zero
    value, a second draft attempt returns the quota message and makes no
    OpenAI call; with the global cap lowered, AI is disabled for everyone
    and raw export keeps working; with `AI_KILL_SWITCH` set, every draft
    attempt 503s immediately; a single call's recorded cost never exceeds
    the per-call bound.
  - Verify: manual, reading `usage_ledger` rows after each attempt. Covers
    SPEC.md Slice 1 criteria 4, 5, 6 and 7.
  - Dependencies: live AI draft happy-path verification, and the
    quota-race fix — criterion 5 cannot honestly pass until that lands

- [x] Task: Content-leak verification
  - Acceptance: after a real "Draft with AI" call, no persona node content
    appears in server stdout, in any error report, or in any `usage_ledger`
    row — confirmed by reading the actual output, not by code inspection.
    Code inspection already looks clean: `lib/log.ts`'s entry type has no
    field that could hold content, and the ledger table has no content
    column. The spec asks for the empirical check anyway, and that is
    precisely the point of the criterion.
  - Verify: manual, reading dev-server or Vercel logs and a `select *` over
    the ledger. Covers SPEC.md Slice 1 criterion 8.
  - Dependencies: live AI draft happy-path verification

- [ ] Task: Fix the privacy policy's placeholder contact address
  - Why: found during the 2026-10-20 verification pass. The Contact
    section reads `your-email@example.com`. The policy is otherwise
    accurate and does name OpenAI as a processor, but a public privacy
    policy cannot ship with a fake contact address — it is the one piece
    of the document a user is told to act on.
  - Acceptance: a real monitored address replaces the placeholder.
  - Files: `app/privacy/page.tsx`
  - Dependencies: none; blocks public launch, not Checkpoint E's other items

- [x] Task: Account-deletion and privacy-policy verification
  - Acceptance: deleting an account removes its auth user and its
    `usage_ledger` rows — the table's `on delete cascade` should handle the
    ledger, so confirm it actually fires rather than assuming. The privacy
    policy naming OpenAI as a processor is reachable and live before the
    sign-in button is exposed publicly.
  - Verify: manual — delete a test account, then query the ledger for its
    user id and confirm zero rows. Covers SPEC.md Slice 1 criteria 9 and 10.
    DONE 2026-10-20. Privacy policy: live, reachable, names OpenAI as a
    processor; its placeholder-contact defect is split out as its own task
    above. Account deletion: run against a purpose-made test account
    instead of the founder's only real one, so the pass's evidence
    survived. Test user created via the admin API, seeded with a ledger
    row, signed in through the app's real `/auth/confirm` route; "Delete
    account" returned 200, dropped to guest state, removed the auth user,
    and cascaded the ledger row away. Founder's account and its three rows
    verified untouched afterwards.
  - Dependencies: live auth verification

### Checkpoint E — Slice 1 ship
- [~] Slice 1 Success Criteria: 8 of 10 fully verified 2026-10-20, 2
      partly — quota concurrency is unit-tested rather than live-raced,
      and the privacy policy carries a placeholder contact address
      (its own task above, blocks public launch)
- [ ] `npm test`, `npm run lint` and `npm run build` pass
- [x] Quota race closed and covered by a test
- [x] Per-user cap numbers ratified in SPEC.md and matching the code
- [x] No doc describes the retired BYOK UI as live
- [ ] code-reviewer pass over the whole Slice 1 diff, with the money path
      (reserve, settle, refund, and the three cap checks) read line by line

## Phase 7: AI node drafting — NOT STARTED, needs its own spec

`ai-node-drafting` is capability-map module 6, listed in SPEC.md's
Boundaries under "Ask first." The founder has given the go-ahead and
resolved SPEC.md Open Question 3 in favour of the interview form over a
chat thread, which is what plan.md recommended and which avoids amending
DESIGN.md's no-chat-bubbles rule.

Settled so far:
- Entry point: after the title field in `NodeEditor`, two options — write
  it yourself, or let AI ask questions.
- Shape: an interview form, not a chat thread. Three to five open questions
  as labelled fields, then a second call drafts the body as editable text.

Still open, and blocking the spec:
- Whether the questions are free-text only (recommended) or include any
  closed or multiple-choice fields.
- Whether voice input is in the first version, and if so whether via the
  browser's built-in speech recognition (free, no server, but unsupported
  in Firefox) or a server-side transcription API (costs money, and needs
  its own fixed task endpoint plus budget plumbing through
  `lib/llm/budget.ts`).

No tasks are written until those are decided and a spec exists.

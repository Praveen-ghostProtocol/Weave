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

---

## Weave v1: capability map (Phase 0 — Scope Check)

Produced by the planning agent (combined ceo+product-manager read) in
response to the founder's request to take Weave public. Full feasibility
assessment; per-module specs happen one at a time, in build order, not all
at once. SPEC.md's Objective/Tech Stack/Boundaries/Success Criteria already
reflect the founder's confirmed decisions (Supabase, $20/mo cap, Google
OAuth only, BYOK retired, guest mode kept, persona data stays local).

### Capability map

"Depends on" means the module needs the listed modules first. No cycles.

| # | Module id | Responsibility | Depends on | Size | Status |
|---|---|---|---|---|---|
| 1 | `platform-backend` | Next.js stops being static: route handlers, Postgres (accounts/sessions/usage ledger only), server-only secrets, migrations, error logging that never records content | none (root) | S | **Slice 1 — building now** |
| 2 | `auth` | Accounts, sessions, Google OAuth sign-in/out, account deletion, guest mode preserved, per-user isolation via Supabase row-level security | platform-backend | M | **Slice 1 — building now** |
| 3 | `llm-proxy` | All OpenAI calls server-side: fixed task endpoints only (no free-form prompt from client), per-task model routing (nano/mini), reserve-then-settle dollar ledger, rate limits, $20/mo global cap, kill switch. Existing "Draft with AI" moves onto it | platform-backend, auth | M–L | **Slice 1 — building now** |
| 4 | `sub-nodes` | Optional `parentId` on PersonaNode, tree invariants (single parent, no cycles), delete = re-parent children (not cascade), editor + canvas support | none (pure `lib/graph/types.ts` change, no backend needed) | M | **Slice 2 — decided and broken down 2026-10-21 (section below, tasks in todo.md Phase 8). Not built. Needs a `sub-nodes` go-ahead recorded in SPEC.md first — Boundaries puts this module under "Ask first"** |
| 5 | `ai-export-selection` | User states a purpose; AI returns relevant node ids + a one-line reason each (structured output, validated against the real graph — hallucinated ids dropped); pre-checks the existing checkbox list | llm-proxy | S | Slice 2 |
| 6 | `ai-node-drafting` | User enters a title; AI asks 3–5 follow-up questions as form fields (interview form, not a chat thread — see Open Question 3); a second call drafts the body into the existing textarea, unsaved, for the user to edit | llm-proxy (soft: sub-nodes, if it suggests a parent) | M | **Shipped 2026-10-21, ahead of Slice 3 — parent suggestion was cut, which removed the `sub-nodes` dependency entirely** |
| 7 | `ai-structure-suggestions` | "This looks like it belongs under X" / "link X and Y," always dismissible, never auto-applied | llm-proxy, sub-nodes | M | Slice 4 |
| 8 | `billing` | Stripe, entitlements, gates the gpt-5.4 flagship tier | auth, llm-proxy | M–L | Deferred |
| 9 | `cloud-sync` | Persona graph moves server-side for multi-device access — **this is where the real privacy/deletion/encryption design SPEC.md has always deferred actually has to get built** | auth, platform-backend | L | Deferred |
| 10 | `graph-indexing` | Stored AI summaries/embeddings/retrieval for very large graphs | llm-proxy (benefits from cloud-sync) | M | Deferred, possibly never — see below |

```
platform-backend ──> auth ──> llm-proxy ──┬──> ai-export-selection
                       │          │       ├──> ai-node-drafting
                       │          │       └──> ai-structure-suggestions <── sub-nodes (independent)
                       │          └──> billing (deferred)
                       └──> cloud-sync (deferred) ···> graph-indexing (deferred)
```

### Why this is smaller than it first looks

**Persona data never has to leave the browser for Slice 1.** Login exists
only to meter AI usage against the founder's OpenAI budget — not to move
graph content server-side. `llm-proxy` can be stateless: the client already
holds the graph, sends only what's needed on an explicit AI action, the
server builds the prompt and forwards it, and nothing about the graph is
stored. The Postgres DB holds only accounts/sessions/the usage ledger. This
is the single biggest scope-reduction in the whole map, and it's also why
Slice 1 doesn't trigger SPEC.md's "real privacy design before any real
backend goes live" gate — no persona content is ever stored server-side.
`cloud-sync` is the module that actually needs that gate, and it's
deferred.

### `llm-proxy`: the module that can lose real money, so it's the riskiest

- **Reserve-then-settle, not check-then-call**: before calling OpenAI,
  reserve the worst-case cost (estimated input + `max_output_tokens` at that
  model's price) in one Postgres transaction. Settle to the real `usage`
  after the response, refund the difference. A naive "check remaining
  budget, then call" has a race under concurrent requests.
- **Fixed task endpoints only** (`draft-brief`, `select-nodes`, `draft-node`,
  `suggest-structure`) — the client sends data, never a prompt. The server
  builds every prompt, caps input tokens (~15k), caps `max_output_tokens`.
  No generic `/chat` passthrough, ever.
- **Reasoning tokens are the main way cost estimates break.** GPT-5.x bills
  hidden reasoning as output tokens — at default effort this can 2-3x a
  call's real cost. Every call must set the lowest reasoning effort the
  model accepts and a hard `max_output_tokens` cap (which includes
  reasoning).
- **Defense in depth, strongest first**: (1) OpenAI prepaid credits,
  auto-recharge off — the real hard stop at the provider. (2) a dedicated
  OpenAI project/key for Weave with budget alerts. (3) the $20/mo
  app-level global cap in the ledger (50%/80% alerts, 100% = "AI paused,"
  raw export keeps working). (4) per-user daily/monthly dollar quotas,
  reserve-then-settle. (5) per-user rate limits (requests/min, concurrent).
  (6) fixed endpoints + input/output caps + lowest reasoning effort (above).
  (7) a kill-switch env var. (8) `safety_identifier` (hashed user id) on
  every OpenAI call. (9) usage logs record (user, task, model, tokens,
  cost) — never content.
- **No anonymous AI.** Per-IP limits are weak (IPv6 rotation, carrier NAT);
  login is the real gate. Guests get full v0 (local graph, raw export), no
  AI.

### Cost reference (OpenAI, per developers.openai.com/api/docs/pricing,
fetched 2026-10-18 — verify before relying on these, pricing moves fast)

| Model | Input/1M | Cached input/1M | Output/1M |
|---|---|---|---|
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 |
| gpt-5.4 (flagship, gated behind `billing`) | $2.50 | $0.25 | $15.00 |

Per-feature estimate (zero reasoning tokens; add up to 2-3x for reasoning
overhead at default effort — the proxy sets lowest effort to avoid this):

| Feature (request shape) | nano | mini |
|---|---|---|
| Draft brief (2.5k in / 500 out) | ~$0.0011 | ~$0.0041 |
| Node drafting, 2 calls (2.5k/700 total) | ~$0.0014 | ~$0.0050 |
| Export selection over a digest (2k/150) | ~$0.0006 | ~$0.0022 |
| Structure suggestions over a digest (2k/300) | ~$0.0008 | ~$0.0029 |

$20/month covers roughly 4,000-18,000 mini-tier actions (more on nano),
before any per-user quota even kicks in — per-user quotas are what actually
prevent one visitor from eating the whole cap.

### `sub-nodes`: data model is easy, canvas UX is the risk (same lesson as v0's GraphView task)

**Decided 2026-10-21.** Everything below is a decision, not a sketch; tasks
are in todo.md Phase 8. The two framing decisions came from the founder and
are not reopened here: **tree, not DAG**, with `parentId` as a field on the
node rather than a typed edge ("contains" and "relates to" mean different
things, and merging them into the edge list destroys the distinction the
feature exists to create); and **AI proposes, never applies** — in fact
nothing in this module calls OpenAI at all, which is a large part of why
it's cheap.

#### Data model

```ts
parentId?: string;   // absent = top level. Never written as null.
```

Optional-and-absent, not `string | null`. Two practical reasons: the whole
graph is stored as **one JSON blob** under a single Dexie key
(`lib/storage/db.ts`), so an added optional field needs **no Dexie version
bump and no migration at all** — existing records simply lack the key and
read as top-level, which is the correct default. And `| null` would create
two spellings of "top level" that every call site then has to handle; one
spelling is one fewer bug.

Three pure functions, all in **one new file** `lib/graph/parent.ts`. They're
mutually dependent (`setParent` is implemented in terms of the ancestor
walk), so splitting them one-per-file the way `linkNodes`/`unlinkNodes` are
split would buy nothing:

- `setParent(graph, nodeId, parentId | undefined)` — throws on self-parent
  and on a cycle (when `parentId` is a descendant of `nodeId`), following
  `linkNodes`' precedent that a logically incoherent operation throws. An
  unknown `nodeId`/`parentId` is a **no-op** returning the graph unchanged,
  following `deleteNode`'s precedent that a missing target isn't an error —
  the editor's picker is built from the live graph, so a stale id there is a
  race, not a user mistake worth an exception.
- `getAncestorIds(graph, nodeId)` — nearest-first. This one function does
  three jobs: the cycle check inside `setParent`, the export rule below, and
  the path labels in the editor's picker and on the canvas card. **It must
  stop at a missing parent id rather than throw, and carry a `visited` set.**
- `getDescendants(graph, nodeId)` — transitive children, excluding the node
  itself; BFS over a `parentId → children` map built once. **Same `visited`
  guard.**

Those `visited` guards are not defensive padding and not optional. A cycle in
the stored blob would make both walks loop forever, on the main thread, every
render — and the blob survives in IndexedDB, so the user's graph would be
permanently unopenable with no UI left to repair it. That's total data loss
for that user from one bad write, which is the "never simplify away error
handling that prevents data loss" case.

**The cycle guard must not be routable around.** `useGraph`'s `updateNode`
currently takes `Partial<Omit<PersonaNode, "id">>`, which already permits
`parentId` — so the editor could set a parent today, bypassing `setParent`
entirely and writing the exact cycle the guard exists to prevent. Fix it at
the type level, not by convention: narrow the patch type to
`Partial<Omit<PersonaNode, "id" | "parentId">>` and add a dedicated
`setParent(nodeId, parentId)` method to the context. TypeScript then makes
the bypass a compile error. `addNode` keeps accepting `parentId` in its
payload and needs no guard — a node that doesn't exist yet can't be an
ancestor of anything.

#### Delete: re-parent confirmed, and specifically *one level up*

plan.md's original recommendation stands, and the reason is the asymmetry of
the mistake. Weave has no undo, no history and no trash — a cascade would
destroy an entire subtree behind a single `window.confirm`, and DESIGN.md §7
prohibits silent data loss outright. Re-parenting loses one level of
*grouping*, which is visible on the canvas the instant it happens and costs
two clicks to restore.

The precise rule: the deleted node's **direct children inherit the deleted
node's own `parentId`** — the subtree rises exactly one level rather than all
of its members becoming top-level. Grandchildren are untouched. If the
deleted node was top-level, its children become top-level. That's the
smallest change that preserves every relationship still having both ends.

**The deleted node's own edges are still all removed, unchanged from today.**
SPEC.md's "Deleting a node removes its edges too — no dangling edges" is a
ticked Success Criterion and this module doesn't touch it. The tempting
symmetry — re-point the deleted node's edges onto its parent, the way its
children are re-pointed — is explicitly rejected: it would invent
relationships the user never drew. "Work contains Project X, Project X
relates to Gym" does not mean "Work relates to Gym", and silently asserting
it would feed that invention into every future export.

The confirm copy must name the consequence with a real count, because the
count is the whole difference between a safe click and a regretted one:
*"Delete 'Work'? Its 3 sub-nodes move up to top level. This can't be
undone."* Copy, not a feature — the cheapest possible mitigation for having
no undo.

#### Export: the one written rule plan.md asked for

The flagged decision, and the one most likely to produce a surprising
export. Reason from what the one-hop rule is *for*: it exists to stop
dangling references — exported text saying "see Work Projects" with that node
absent. Hierarchy produces a *stronger* dangling reference than a link does.
A child's body is frequently only legible under its parent ("Sprint rituals"
means nothing without "Acme"), whereas a parent's body is self-contained
without its children. So the rule is asymmetric, and the asymmetry *is* the
decision:

> **Ancestors in, descendants out. Neither counts toward the one-hop
> expansion, which stays link-only.**

> **AMENDED BY THE FOUNDER, 2026-10-21.** Selecting a parent must also get
> its sub-nodes. Their wording resolves the objection below rather than
> overriding it: the sub-nodes *get selected*, visibly, rather than being
> silently appended at export time. So the checkbox list still shows
> exactly what will be exported and the counter still matches it.
>
> The split that implements it:
> - `exportContext` is **unchanged** — selection, plus ancestors, plus
>   one-hop neighbours. It never adds descendants of its own accord.
> - `ExportPanel` cascades the *checkbox*: ticking a parent ticks every
>   descendant, unticking it unticks them. A child stays independently
>   toggleable afterwards, so "everything under Academics except the one
>   embarrassing module" is still expressible.
>
> Deliberately not done inside `exportContext`: if the function re-added
> descendants, unticking a single child would silently do nothing, and the
> list would again stop meaning what it shows. One mechanism, in the place
> the user can see.

As the exact set:

```
included = selected ∪ ancestors(selected) ∪ neighbours(selected)
```

and nothing else. Three consequences worth stating separately, because each
is a thing someone will otherwise re-litigate:

1. **A selected child pulls in its whole ancestor chain to the root**, not
   just its immediate parent. Bounded by tree depth (realistically 2-3), and
   a half-chain ("Sprint rituals" under a parent whose own parent is missing)
   is exactly the dangling reference the rule exists to prevent.
2. **A selected parent does not pull in its descendants.** Selecting "Work"
   with twelve children would silently export thirteen nodes; the token
   counter would stay truthful (it's the same function) but the *selection*
   would stop meaning what the checkbox list shows, which is worse than a
   missing node. A parent's own body is a legitimate thing to export alone.
   The mitigation is to make selecting the subtree **easy and visible**
   rather than automatic — children indented in the export list, with a
   per-parent subtree-select affordance (todo.md Phase 8).
3. **No neighbours of ancestors, and no ancestors of neighbours.** This is
   the rule that keeps the export from quietly becoming the whole graph.
   Hierarchy makes the graph dramatically more connected — a root node is an
   ancestor of its entire subtree — so any transitive rule explodes. Every
   included node stays **exactly one derivation step** from the selection,
   which is what today's rule already does.

Rendering stays flat: `##` for every node, plus one added meta line
`*Under: Work / Acme*` when the node has an ancestor chain. Deliberately not
a nested-heading rewrite — that would mean ordering output as a tree
traversal, would change the shape of existing exports, and gains nothing a
model can't read from the words. **Ordering does change**: ancestors are
emitted immediately before the selected node that pulled them in (root
first), so the block reads top-down; dedup by id is unchanged.

One rule covers both export paths. "Draft with AI" POSTs the markdown
`exportContext` produces, so it inherits this for free — no second decision
for the AI path, and no second place for the two to drift.

#### Canvas: nesting rejected, and more firmly than before

plan.md's recommendation — separate cards plus a distinct containment
connector, not react-flow's native `parentId` container nesting — is
confirmed, and two of its three reasons are stronger now than when it was
written.

- **Native nesting makes child positions relative to the parent.** Every
  `position` already persisted in IndexedDB is absolute, and the drag-persist
  path (`onNodesChange` → `updateNode(id, {position})`) writes back whatever
  react-flow reports. Under nesting the *meaning* of the one field this app
  already stores would change the moment a node gained a parent, and nodes
  saved before and after would be silently incomparable. That's a data change
  disguised as a rendering choice, and it's decisive on its own.
- **It puts the just-shipped link-remove control at risk.**
  `PersonaEdgeComponent` places its remove button at the bezier midpoint in
  absolute flow coordinates via `EdgeLabelRenderer` and relies on a 20px
  transparent hit path. Children inside a container live in a different
  coordinate space, and edge stacking across a container boundary is a rough
  edge in react-flow — so the hit path for an intra-parent link can end up
  under the container's own surface. The founder asked for that affordance a
  day ago because they'd concluded links were permanent; regressing it to
  gain nested rendering is a bad trade.
- **A container is a card-on-card.** DESIGN.md §3 bans elevation theater and
  specifies exactly one card treatment. A parent would need a second
  rendering mode, and §3 starts getting argued with rather than followed.

What to build instead:

- **Containment is a second react-flow edge type, derived at render time from
  `node.parentId`** — never stored in `graph.edges`. Built in the same
  `useEffect` that maps `graph.edges`, with id `contains:<parent>-><child>`.
  It must be `selectable: false` and `deletable: false`, **and**
  `onEdgesChange`'s remove branch must early-return on that id prefix. Two
  belts for one bug, because the current handler calls
  `unlinkNodes(edge.source, edge.target)` on any removal — reaching it with a
  containment edge would fire an unlink for a link that doesn't exist and
  blank the connector until the next resync.
- **Distinguish by geometry, not colour.** DESIGN.md allows one accent and
  one line colour; a second hue is out. So: 1.5px `--line` **dashed**, with a
  `--line` arrowhead at the child end. Dashed reads as structural, solid as a
  link the user drew. Critically, **the containment connector never turns
  `--accent`**, even when an endpoint is selected — if structure highlighted
  the same way links do, the two would become indistinguishable at precisely
  the moment the user is inspecting one, and "accent means something I drew
  or selected" would stop being true.
- **The child card also says what it's under**, as one 12px Plex Mono
  `--ink-muted` line in the existing meta slot. Redundant with the connector
  on purpose: layout is manual, so a child can sit 2000px from its parent
  with the connector running off-screen entirely. Cuttable if the card gets
  crowded, but it's one line and it's what makes hierarchy readable at a
  glance.
- **No drag-to-nest.** Dropping a node onto another to re-parent it conflicts
  with free positioning (every incidental overlap becomes a claim of intent),
  needs a hover-target affordance DESIGN.md doesn't have, and leans on
  react-flow's node-intersection API — the exact scope overrun this section
  exists to avoid. The canvas is read-only for hierarchy in this phase. If
  testers try it and nothing happens, that's the signal to spec it properly.

#### Editor: one row, zero new states

A parent is set by **one compact row directly under Domain: label "Part of",
a native `<select>`**. Nothing more.

This panel's complexity budget is spent on *states*, not rows — it already
carries interview mode, a proposed-draft block, sign-in prompts, two AI error
paths and an in-flight guard. A native select adds **no state at all**: no
async, no loading, no error, no AI, nothing that interacts with interview
mode. That's the entire reason it fits, and the reason a searchable combobox
or a drag-and-drop tree picker doesn't. Rung 4 of the ladder: the platform
already ships this control.

- Placement under Domain, not near Notes: "Part of" is metadata of the same
  kind as the domain tag, and the compact metadata cluster at the top of the
  panel is where metadata already lives. It doesn't touch the Notes
  textarea's `flex-1`, which DESIGN.md §4 says must breathe.
- Options are `None (top level)` plus every node **except self and its
  descendants** — so a cycle is simply unreachable from the UI. Option labels
  show the ancestor path (`Work / Acme`) so two children both named
  "Logistics" are distinguishable. No `<optgroup>`; tens of nodes don't need
  it.
- `setParent` still throws on a cycle even though the UI can't produce one.
  Same reasoning already written into this codebase for auth: the UI is UX,
  not the gate.
- **`parentId` joins the `isDirty` comparison.** Easy to forget, and the
  consequence is that switching nodes mid-change discards the choice with no
  warning — the exact failure the dirty check exists to prevent.
- Save calls `setParent` alongside `updateNode` (two context calls, one
  handler, no new plumbing). For a new node, `parentId` rides along in
  `addNode`'s payload.
- **A new child is placed near its parent**, by offsetting from the parent's
  position instead of `Math.random() * 200`. One line, and it prevents the
  worst first impression of the feature: a child appearing in a random corner
  with a dashed line stretched across the whole canvas. Not auto-layout —
  SPEC.md's manual-layout rule stands.
- Domain inheritance: **prefill only, never derived.** When a parent is
  chosen and the domain field is empty, fill it with the parent's domain. A
  live derived value would mean re-parenting silently rewrites a child's
  domain — an invisible content change — and would give the field two
  meanings. Prefill is ~2 lines and cuttable; derivation is a model concept
  and is rejected.

#### Doc changes this module needs (founder's call, not written by the planner)

- **SPEC.md** — a `sub-nodes` section recording the go-ahead (Boundaries puts
  this module under "Ask first", so building it without one violates the
  founder's own rule); the export rule above added to Graph & Export
  Semantics; one Success Criterion for re-parent-on-delete and one for the
  export rule.
- **DESIGN.md §4** — the containment connector (dashed `--line`, arrowhead,
  never accent), the card's parent line, the editor's "Part of" row.
  **§7** — the delete confirm copy naming the sub-node consequence.

#### Risks and mitigations (additive)

| Risk | Impact | Mitigation |
|------|--------|------------|
| A cycle reaches the stored blob (bypassed guard, hand-edited record, a future import) | **Highest — both tree walks loop forever on the main thread, and the bad state persists in IndexedDB, leaving the user's graph permanently unopenable** | `visited` set in both walks (non-negotiable); `parentId` removed from `updateNode`'s patch type so the guard can't be bypassed in TypeScript; one unit test per walk feeding a hand-built cyclic graph |
| The export rule surprises the user — more or fewer nodes than the selection implies | High — export is the entire product | The two explosion guards get their own named unit tests (an ancestor's neighbour is NOT included; a neighbour's ancestor is NOT included); children indented in the export list so the hierarchy the rule acts on is visible where the selection happens |
| Deleting a parent is still destructive with no undo, re-parenting or not | Medium — one confirm click, no recovery | Confirm copy names the real child count and the exact consequence; re-parenting bounds the loss to one level of grouping |
| A containment edge reaches `onEdgesChange`'s remove branch and fires `unlinkNodes` | Medium — connector blanks until resync, and it reads as a link having been deleted | `selectable: false` + `deletable: false` + id-prefix early-return |
| Scope overrun into nested container rendering or drag-to-nest mid-task | Medium — the v0 GraphView lesson, repeating | Both are rejected above by name, with reasons, so "just try nesting" is a decision to reverse rather than a gap to fill |

### `graph-indexing` ("graphify"): premature now, two cheap pieces worth having early

Token cost is not the real driver at this scale — a 50-node graph (~15k
tokens) costs about $0.01 on mini, and gpt-5.4 has 272k context. Two
near-free pieces fold into other modules instead of becoming their own:
1. **`graphDigest(graph)`**: a deterministic, non-AI pure function (title,
   domain, parentId, neighbor ids, first ~150 chars of body per node) —
   cuts whole-graph calls 5-10x, shared by `ai-export-selection` and
   `ai-structure-suggestions`, never goes stale, no AI summaries to
   maintain. Build inside `ai-export-selection`.
2. **Prompt ordering for OpenAI's automatic prompt-prefix caching**: static
   system prompt → deterministically-serialized graph → variable part last.
   Cached input is ~90% cheaper. No extra code beyond ordering. Build
   inside `llm-proxy`.

Defer real graph-indexing (stored AI summaries, embeddings, retrieval)
until a real user's graph exceeds ~50k tokens, or the digest measurably
hurts selection quality, or `cloud-sync` exists (so summaries can be
computed server-side on save). May never be needed for a personal graph.

### Design/boundary tensions that block later slices, not Slice 1

- **`ai-node-drafting` (Slice 3)**: DESIGN.md explicitly bans chat-bubble/
  chat-app visual language. A true conversational flow means amending that
  rule on purpose. Recommended instead: an interview form — one AI call
  returns 3-5 follow-up questions shown as labeled fields in the existing
  NodeEditor, a second call drafts the body as editable proposed text.
  Bounded cost (2-3 calls), no DESIGN.md amendment needed. This is still an
  open decision (SPEC.md Open Question 3) — not resolved yet.
- **`ai-structure-suggestions` (Slice 4)**: auto-triggering on every save
  would violate SPEC.md's "explicit user action" boundary and burns budget
  on every edit. Three options, still open (SPEC.md Open Question 3): (1) a
  "Suggest structure" button only (no boundary change, recommended for
  first ship), (2) an opt-in auto-trigger toggle (requires amending the
  Boundaries section on purpose, plus debouncing + a daily cap), (3) a
  zero-AI local heuristic (title/domain string matching) running
  automatically for free, with real AI analysis staying behind a button.

### Verdict

Feasible as one cohesive plan. Real risks are (1) correctness of the spend
controls — the only part that can cost real money — (2) scope (7 buildable
modules + 3 deferred, several times v0's size), (3) the privacy obligations
`cloud-sync` will eventually trigger, (4) the two open design/boundary
decisions above. Recommended build order: Slice 1 (this phase) → Slice 2
(`ai-export-selection` + `sub-nodes`, independent of each other) → Slice 3
(`ai-node-drafting`, blocked on its open decision) → Slice 4
(`ai-structure-suggestions`, blocked on sub-nodes + its open decision) →
deferred modules only when there's real demand or graphs outgrow the
digest.

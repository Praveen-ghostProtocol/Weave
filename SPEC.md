# Spec: Weave — Personal Context Graph

## Objective
A web app where a user builds their "AI context" as a graph of linked persona
files — one node per life domain (work, clubs, projects, academics, etc.),
each a structured markdown record, cross-referenced to each other, viewable
as an interactive graph, and exportable as a copy-pasteable context block for
any AI chat (ChatGPT, Claude, etc.).

User: someone who's tired of re-explaining who they are to an AI every time,
and wants a living, structured "about me" they maintain once and reuse
everywhere.

**v0 validated the core loop**: a user builds and links persona nodes and
finds the exported context useful. The founder is moving to public launch
now, on their own judgment, ahead of the original "2 weeks of personal use"
bar in Open Question 1 below — a deliberate override, not an oversight.

Out of scope for this spec: ChatGPT/Claude plugin (MCP bridge), any social/
sharing features (only if there's traction later).

**v1 — Public Launch (Slice 1), capability-mapped by the planning agent.**
Goal: anyone can use Weave's AI features without needing their own API key,
without the founder's OpenAI budget being drainable by abuse, and without
rebuilding more than necessary. Full capability map and the modules deferred
past Slice 1 (sub-nodes, AI node drafting, AI export selection, proactive
structure suggestions, graph indexing, billing, cloud sync) live in
`tasks/plan.md`'s "Weave v1" section — this spec covers Slice 1 only:
`platform-backend` + `auth` + `llm-proxy`.

**The one scope decision that keeps this small**: persona graph data stays
in the browser (IndexedDB), exactly as in v0 — login exists only to meter
AI usage against the founder's budget, not to move persona content to a
server. This is why Slice 1 does NOT trigger the "real privacy/data-handling
design (encryption at rest, deletion semantics, backups)" v0 always deferred
to a real backend going live — no persona content is ever stored
server-side. That gate still applies whenever `cloud-sync` (deferred,
capability map) is built.

Confirmed by the founder: Supabase for auth + Postgres (not Auth.js+Neon),
$20/month hard global OpenAI spend cap with a kill switch, and the BYOK
Anthropic feature (below) is retired once this ships — one provider, one
proxy, one error model, not two parallel AI paths in a public product.

**Addendum — AI draft assist. BYOK RETIRED 2026-10-20, historical record
only.** The raw export (concatenated node content) is the default and still
works with zero setup — this has never changed and still holds. v0
additionally let a user supply their own Anthropic API key (stored in their
browser only) and have Weave call Claude directly. **That path is now
gone**: `lib/llm/anthropic.ts`, `lib/storage/apiKey.ts`, the key input, the
Save/Clear buttons and the `Key` icon were all deleted when `llm-proxy`'s
`draft-brief` endpoint shipped. "Draft with AI" now POSTs to
`/api/ai/draft-brief` and is available to signed-in users with no key of
their own. Nothing below describes live behaviour; it is kept to explain
why the code looks the way it does. Do not build on it, and do not
reintroduce a user-supplied key.

**Known, accepted tradeoff of the v0 BYOK architecture** (not a bug, flagged
by red-team review, resolved by retiring BYOK): because the browser called
Anthropic directly, the API key was visible in plaintext in that browser's
own Network tab/devtools on every request. Acceptable for a v0 feature the
user opted into with their own key; exactly the reason it doesn't carry into
the public version, where `llm-proxy` keeps the real key server-side only.

## Tech Stack
- Next.js (App Router) + TypeScript + React — static client app, no server-side DB
- Tailwind CSS
- Local persistence: IndexedDB via Dexie (data never leaves the browser in v0)
- Graph rendering: react-flow, manual layout (user drags/saves node positions,
  no force-directed physics — expected node count per user is small, tens not
  hundreds, so auto-layout is overkill)
- Deployed on Vercel as a static app (no DB, no server cost)
- ~~AI draft assist (v0): direct `fetch` to Anthropic's Messages API from
  the browser, user's API key in `localStorage`.~~ **Retired 2026-10-20** —
  deleted outright, replaced by `llm-proxy` below. No Anthropic dependency
  and no user-supplied key remains anywhere in the app.
- **Slice 1 (v1 public launch)**:
  - Supabase: Postgres + auth (Google OAuth at launch — no passwords, no
    reset flow, no credential-stuffing surface) + row-level security for
    per-user isolation of the Postgres tables (accounts, sessions, usage
    ledger only — never persona content, which stays in the user's own
    browser IndexedDB as in v0).
  - Next.js Route Handlers (the app stops being a pure static export;
    deployed on Vercel Pro — commercial use isn't covered by Hobby).
  - `llm-proxy`: server-side OpenAI calls only, via fixed task endpoints
    (the client never sends a free-form prompt). **`gpt-5.4-nano` is the
    default for every task, including prose**, and `gpt-5.4-mini` is the
    escape hatch for a specific task whose output quality proves too weak
    on nano — not the starting point for prose. No `gpt-5.4` (flagship)
    tier until `billing` exists. Lowest reasoning effort each model
    accepts, hard `max_output_tokens` cap, prompts ordered for OpenAI's
    automatic prompt-prefix caching.

    *This reverses an earlier nano-for-structured / mini-for-prose split
    (founder's call, 2026-10-20): running cost matters more at launch than
    prose polish, and the per-task model is one exported constant, so
    moving a task up to mini is a one-line change if its output disappoints.
    `draft-brief` runs on nano. If you are reading this and tempted to
    "fix" it back to mini, that is the decision, not an oversight. The
    model constant and its two price constants in `lib/llm/openai.ts` must
    always change together — `lib/llm/budget.ts` reserves and settles
    against those prices, so a model swap without a price swap silently
    mis-bills the ledger and every cap derived from it.*
  - Spend controls (defense in depth, see tasks/plan.md for the full list):
    OpenAI prepaid credits with auto-recharge off (the real hard stop),
    $20/month app-level global cap with a kill switch, per-user daily/
    monthly dollar quotas via reserve-then-settle (not just request
    counts), `safety_identifier` on every OpenAI call.
  - **Per-user quotas, ratified by the founder 2026-10-20: $0.05/day and
    $0.25/month.** These are the numbers the code implements, not a
    placeholder it invented. At nano pricing a worst-case call costs about
    $0.0043 (15k input capped + 1024 max output), so the daily cap is
    roughly 11 calls and the monthly cap roughly 58. Changing either is an
    "Ask first" item below; change them here and in
    `app/api/ai/draft-brief/route.ts` together, never one alone.
  - **Quota enforcement is reserve-first, then check.** The cap comparison
    reads totals that already include the request's own reservation.
    Checking the caps before inserting the reservation leaves a
    read-then-write gap that concurrent requests pass through together,
    which would break the "can't together exceed their quota" criterion
    below. Under contention this over-rejects rather than overspends.
- **Deferred past Slice 1** (capability map in tasks/plan.md): `sub-nodes`,
  `ai-node-drafting`, `ai-export-selection`, `ai-structure-suggestions`,
  `graph-indexing`, `billing`, `cloud-sync` (this is where the real privacy/
  deletion design from the old "Deferred to v1" line actually lands, once
  persona content would ever touch the server).

## Commands
```
npm run dev              # local dev server
npm run build && npm start
npm run lint
npm test                 # vitest, unit tests
npx playwright test      # e2e
```

## Project Structure
```
app/              → Next.js routes (App Router)
components/       → React components (graph view, node editor, export panel)
lib/graph/        → graph data model + operations (link, unlink, export)
lib/storage/       → IndexedDB wrapper (Dexie)
tests/            → vitest unit tests
e2e/              → playwright specs
tasks/            → plan.md, todo.md (spec-driven-development artifacts)
DESIGN.md         → visual/UX direction (product-manager owns this)
.claude/agents/   → ceo, product-manager, developer, code-reviewer, red-team
```

## Code Style
TypeScript strict mode, functional components, no class components.

```ts
// lib/graph/linkNodes.ts
export function linkNodes(graph: PersonaGraph, fromId: string, toId: string): PersonaGraph {
  if (fromId === toId) throw new Error("cannot link a node to itself");
  const exists = graph.edges.some(
    (e) => (e.fromId === fromId && e.toId === toId) || (e.fromId === toId && e.toId === fromId)
  );
  if (exists) return graph; // edges are undirected and deduped
  return { ...graph, edges: [...graph.edges, { fromId, toId }] };
}
```

## Testing Strategy
- Vitest for pure logic (graph operations, export formatting, validation).
- Playwright for one critical-path e2e test: create node → link two nodes →
  see them in graph view → export context → text matches both nodes' content.
- No fixed coverage percentage for v0. Every new data/graph function ships
  with at least one test (trivial getters/setters excluded).

## Graph & Export Semantics
- **Edges** are undirected and deduped (linking A→B when B→A exists is a
  no-op). Deleting a node removes its edges too — no dangling edges.
- **Export**: selecting node(s) includes their directly-linked neighbors by
  default (one hop), so exported context stays coherent instead of containing
  dangling references like "see Work Projects" with that node missing. No
  hard truncation in v0 — show a running character/token-estimate count so
  the user can judge if it's too big for their target chat.
- **Export with zero nodes selected**: export action is disabled, not an
  error state.
- **AI draft assist**: a separate, clearly-labeled action from the raw
  export (never silently replaces it — raw export must keep working with
  no account at all). POSTs the same node content that raw export would
  produce (selected nodes + one-hop neighbors) to `/api/ai/draft-brief`,
  which builds the prompt server-side and asks OpenAI for a concise
  first-person context brief, then shows the result for the user to copy —
  Weave never auto-pastes or auto-sends it anywhere else. Signed out, the
  action fires no request and prompts for sign-in. Any failure (quota
  spent, global cap reached, kill switch, upstream error) shows a clear
  inline message, never a silent failure or an unhandled rejection.

## Boundaries
- **Always**: run `npm test` before marking a task done, never commit
  secrets; write code per the `ponytail` skill — no unrequested
  abstractions, no boilerplate, the first lazy solution that works; any UI
  work follows `DESIGN.md` and is checked against `design-taste-frontend`/
  `web-design-guidelines`; persona graph content stays client-side only
  (IndexedDB) — Slice 1 adds accounts for AI-usage metering, it does not
  move persona content to the server; any content sent to OpenAI goes
  through `llm-proxy` only on an explicit user action (never auto-triggered
  on save/edit), and is never stored or logged server-side — only
  (user, task, model, tokens, cost) is logged, never content; the OpenAI
  key lives only in a server env var, never sent to the client; the
  session-user id for any OpenAI/DB call always comes from the server
  session, never trusted from request body/client state.
- **Ask first**: any module from tasks/plan.md's capability map beyond
  Slice 1 (sub-nodes, AI node drafting, AI export selection, structure
  suggestions, graph indexing, billing, cloud sync) — each needs its own
  spec and explicit go-ahead, not silent scope creep once the backend
  exists; any change to the $20/month global spend cap or per-user quotas;
  any IndexedDB/Postgres schema change that isn't additive.
- **Never**: add auto-posting/social/public-sharing behavior (out of
  scope); store the OpenAI key anywhere but the server env var; let the
  `llm-proxy` accept a free-form client-supplied prompt (fixed task
  endpoints only — the server builds every prompt); skip the reserve-then-
  settle budget check before an OpenAI call "just this once"; ship Slice 1
  without the account-deletion flow or without a privacy policy naming
  OpenAI as a processor.

## Success Criteria
- [x] User can open the app with zero setup and create a persona node (title,
      domain tag, markdown body) — works correctly on a fresh/empty graph.
- [x] User can link two nodes; link is visible from both sides; relinking the
      same pair is a no-op.
- [x] Deleting a node removes its edges with it.
- [x] Graph view renders nodes + edges (manual layout, positions persist),
      clicking a node opens it.
- [x] User can select nodes (or "all") and export a combined markdown context
      block that includes directly-linked neighbors of selected nodes.
- [x] Export is disabled when selection is empty.
- [x] Deployed, reachable via a public URL, works for a first-time visitor
      with zero existing data (empty state doesn't break). —
      https://weave-three-dusky.vercel.app/
- [x] UI reviewed by product-manager against `DESIGN.md` and doesn't read as
      generic/templated AI output (default bento grids, stock gradients,
      centered-hero-two-buttons, etc.).

### AI draft assist (addendum) — superseded 2026-10-20
These were met by the v0 BYOK build and are kept for the record. The key
affordance they describe no longer exists; the Slice 1 criteria below are
the live ones. Struck where the retirement made them meaningless, restated
where the behaviour survived the move to the proxy.

- ~~User can enter an Anthropic API key in a settings affordance; it's
  stored in `localStorage` only and persists across reloads.~~ Retired —
  no key affordance exists; signed-in session replaces it.
- [x] **Still live, still required.** Raw export (copy-to-clipboard) works
      with zero setup and no account — AI draft assist is additive, never
      a replacement.
- ~~With a key set, "Draft with AI" sends the current selection to
  Anthropic...~~ Restated as Slice 1 criterion 3 below, against the
  server-side OpenAI proxy.
- ~~No key set: "Draft with AI" shows a clear inline prompt to add one.~~
  Restated: signed out (or on a lapsed session), "Draft with AI" fires no
  request and shows an inline sign-in prompt, keeping its normal styling —
  a discoverable state, not a failure. Verified 2026-10-20.
- [x] **Still live, still required.** An API failure shows a clear inline
      error, not a silent failure or an unhandled rejection. The wording
      now comes from the route, which is the side that knows whether it
      was a quota, the global cap, the kill switch, or an upstream fault.

### Slice 1 — Public launch (platform-backend + auth + llm-proxy)

**Verification pass run 2026-10-20 against a live signed-in session, a real
Supabase project and real OpenAI calls.** Total spend: $0.000195. Evidence
below; `[~]` means partly verified, with the gap named.

- Sign-in, persistence, sign-out: session survived two full dev-server
  restarts and several reloads; sign-out returned the app to guest state.
- Guest mode: after sign-out the local graph, the checkbox list and raw
  export all still worked, and "Draft with AI" fired no request at all.
- Draft without a key: returned a genuine first-person brief on
  `gpt-5.4-nano`, with no key present anywhere in the browser.
- Per-call cost: the settled row was $0.000195 (135 in / 134 out) against a
  reservation ceiling of $0.001293 — actual cost matched the price
  constants to the microdollar.
- `[~]` Quota: the daily cap rejection was verified live (429, correct
  message, and the reservation fully refunded so billable spend did not
  move). The *concurrency* half of this criterion is covered by a unit test
  asserting that `reserve` is invoked before any cap read, not by firing
  genuinely simultaneous live requests. The mechanism is proven; a live
  race was not staged.
- Global cap: 503 with the right message, and "Export selection" stayed
  enabled throughout.
- Kill switch: 503 in 311ms with 90ms of application code — no OpenAI call
  and no ledger row written, so it short-circuits before anything can
  spend.
- Content leak: the usage log line carries only (user, task, model, tokens,
  cost, timestamp). Grepping the full server log for three distinctive
  phrases from the node body returned nothing, and `usage_ledger` has no
  content column.
- Account deletion: verified 2026-10-20 on a purpose-made test account
  rather than the founder's own, so the pass's evidence survived. A test
  user was created via the admin API, given a seeded `usage_ledger` row,
  and signed in through the app's real `/auth/confirm` magic-link route.
  Clicking "Delete account" returned 200, dropped the app back to guest
  state, removed the auth user, and took the ledger row with it — the
  `on delete cascade` fires for real, it isn't just declared in the
  migration. The founder's own account and its three rows were untouched,
  confirmed by querying both before and after.
- `[~]` Privacy policy: live, reachable, and names OpenAI as a processor.
  **Defect: the Contact section still reads `your-email@example.com`.** A
  public privacy policy must not ship with a placeholder address.
- [x] A visitor can sign in with Google; a session persists across reload;
      sign-out works.
- [x] Guest mode still works exactly like v0 today — full local graph app,
      raw export, zero setup, no AI — for anyone not signed in.
- [x] Signed-in user can use "Draft with AI" without supplying any API
      key — it calls the server-side proxy using the founder's OpenAI key.
- [x] A single OpenAI call never costs the founder more than the per-call
      cap (input + max_output_tokens bounded, lowest reasoning effort).
- [~] Per-user daily/monthly quota is enforced via reserve-then-settle —
      concurrent requests from one user can't together exceed their quota.
- [x] Hitting the $20/month global cap disables AI for everyone (not a
      crash) and raw export keeps working regardless.
- [x] The kill-switch env var disables all AI calls immediately when set.
- [x] No persona node content appears in any server log, error report, or
      Postgres table — verified by reading actual logs after a real
      "Draft with AI" call, not just by code inspection.
- [x] Account deletion removes the user's account/session/usage rows.
- [~] A privacy policy naming OpenAI as a processor is live before the
      Supabase sign-in button is.

## Open Questions
1. **Resolved.** v0's core loop was validated well enough for the founder
   to move to public launch on their own judgment (see Objective) — the
   "2 weeks of personal use" bar was consciously overridden, not reached.
2. **Resolved (Slice 1 decisions, confirmed by the founder).** Supabase
   over Auth.js+Neon; Google OAuth only at launch (no passwords); guest
   mode kept, no AI for guests; $20/month global OpenAI spend cap; BYOK
   Anthropic retired once `llm-proxy` ships; Vercel Pro accepted as a
   recurring cost.
3. **Open — decide before its module gets a spec, not now.** Node drafting
   (Slice 3): chat thread (requires amending DESIGN.md's no-chat-bubbles
   rule) vs. an interview-style form (recommended — bounded cost, fits
   existing DESIGN.md rules). Structure suggestions (Slice 4): button-only
   trigger (recommended, no boundary change) vs. an opt-in auto-trigger
   toggle (requires amending this Boundaries section's "explicit user
   action" rule) vs. a zero-AI local heuristic plus an AI button.

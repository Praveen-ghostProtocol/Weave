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

**Addendum — AI draft assist (v0, being retired by Slice 1).** The raw
export (concatenated node content) is the default and still works with zero
setup — this does not change. v0 additionally let a user supply their own
Anthropic API key (stored in their browser only) and have Weave call Claude
directly. **This BYOK path is retired once `llm-proxy` ships** (confirmed by
the founder) — replaced by the server-side OpenAI proxy, available to
signed-in users without needing their own key. Kept below for the historical
record and because it's still live until the replacement ships; do not build
new features on top of it.

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
- AI draft assist (v0, being retired): direct `fetch` to Anthropic's
  Messages API from the browser. User's API key stored in `localStorage`
  only, read at call time, never bundled/committed/logged.
- **Slice 1 (v1 public launch)**:
  - Supabase: Postgres + auth (Google OAuth at launch — no passwords, no
    reset flow, no credential-stuffing surface) + row-level security for
    per-user isolation of the Postgres tables (accounts, sessions, usage
    ledger only — never persona content, which stays in the user's own
    browser IndexedDB as in v0).
  - Next.js Route Handlers (the app stops being a pure static export;
    deployed on Vercel Pro — commercial use isn't covered by Hobby).
  - `llm-proxy`: server-side OpenAI calls only, via fixed task endpoints
    (the client never sends a free-form prompt) — `gpt-5.4-nano` for
    structured/cheap tasks, `gpt-5.4-mini` for prose, no `gpt-5.4`
    (flagship) tier until `billing` exists. Lowest reasoning effort each
    model accepts, hard `max_output_tokens` cap, prompts ordered for
    OpenAI's automatic prompt-prefix caching.
  - Spend controls (defense in depth, see tasks/plan.md for the full list):
    OpenAI prepaid credits with auto-recharge off (the real hard stop),
    $20/month app-level global cap with a kill switch, per-user daily/
    monthly dollar quotas via reserve-then-settle (not just request
    counts), `safety_identifier` on every OpenAI call.
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
  export (never silently replaces it — raw export must keep working with no
  API key set). Sends the same node content that raw export would produce
  (selected nodes + one-hop neighbors) to Anthropic's API, asks it to write
  a concise first-person context brief, and shows the result for the user to
  copy — Weave never auto-pastes or auto-sends it anywhere else. A missing
  or invalid key shows a clear inline error, not a silent failure; an API
  error (rate limit, network) does the same.

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

### AI draft assist (addendum)
- [x] User can enter an Anthropic API key in a settings affordance; it's
      stored in `localStorage` only and persists across reloads.
- [x] Raw export (copy-to-clipboard) still works with zero setup, no key
      required — AI draft assist is additive, never a replacement.
- [x] With a key set, "Draft with AI" sends the current selection (same
      content raw export would use) to Anthropic and shows a synthesized
      first-person brief instead of raw concatenation.
- [x] No key set: "Draft with AI" shows a clear inline prompt to add one,
      not a silent no-op or a crash.
- [x] An API error (bad key, rate limit, network failure) shows a clear
      inline error, not a silent failure or an unhandled rejection.

### Slice 1 — Public launch (platform-backend + auth + llm-proxy)
- [ ] A visitor can sign in with Google; a session persists across reload;
      sign-out works.
- [ ] Guest mode still works exactly like v0 today — full local graph app,
      raw export, zero setup, no AI — for anyone not signed in.
- [ ] Signed-in user can use "Draft with AI" without supplying any API
      key — it calls the server-side proxy using the founder's OpenAI key.
- [ ] A single OpenAI call never costs the founder more than the per-call
      cap (input + max_output_tokens bounded, lowest reasoning effort).
- [ ] Per-user daily/monthly quota is enforced via reserve-then-settle —
      concurrent requests from one user can't together exceed their quota.
- [ ] Hitting the $20/month global cap disables AI for everyone (not a
      crash) and raw export keeps working regardless.
- [ ] The kill-switch env var disables all AI calls immediately when set.
- [ ] No persona node content appears in any server log, error report, or
      Postgres table — verified by reading actual logs after a real
      "Draft with AI" call, not just by code inspection.
- [ ] Account deletion removes the user's account/session/usage rows.
- [ ] A privacy policy naming OpenAI as a processor is live before the
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

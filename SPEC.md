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

**v0 validates one thing only: will a user actually build and link persona
nodes, and find the exported context useful.** No accounts, no backend — see
Tech Stack. If the loop proves out, v1 adds accounts/sync; only then does a
real privacy/data-handling design (encryption at rest, deletion semantics,
backups) get built, before any real backend goes live.

Out of scope for this spec: ChatGPT/Claude plugin (MCP bridge — phase 2),
any social/sharing features (phase 3, only if there's traction).

**Addendum — AI draft assist.** The raw export (concatenated node content)
is the default and still works with zero setup. Additionally, a user can
optionally supply their own Anthropic API key (stored in their browser only)
and have Weave call Claude directly to turn the selected nodes into a
polished, synthesized prompt instead of raw concatenation. This stays
"no backend": the browser calls Anthropic's API directly, nothing is
proxied or stored server-side. See the new Boundaries entries and Success
Criteria below for the rules this must follow.

**Known, accepted tradeoff of this architecture** (not a bug, flagged by
red-team review): because the browser calls Anthropic directly, the API key
is visible in plaintext in that browser's own Network tab/devtools on every
request — inherent to "no backend, no proxy," not something code can fix
without reintroducing a server. Anyone with devtools access to the user's
own browser session (or a malicious extension) could read it. Acceptable
for a v0 BYOK feature the user opts into with their own key; would need
revisiting if this pattern carries into a version other people use with
keys that aren't theirs.

## Tech Stack
- Next.js (App Router) + TypeScript + React — static client app, no server-side DB
- Tailwind CSS
- Local persistence: IndexedDB via Dexie (data never leaves the browser in v0)
- Graph rendering: react-flow, manual layout (user drags/saves node positions,
  no force-directed physics — expected node count per user is small, tens not
  hundreds, so auto-layout is overkill)
- Deployed on Vercel as a static app (no DB, no server cost)
- AI draft assist: direct `fetch` to Anthropic's Messages API from the
  browser (no SDK needed for one endpoint — ponytail: don't add a dependency
  for what one `fetch` call does). User's API key stored in `localStorage`
  only, read at call time, never bundled/committed/logged.
- **Deferred to v1** (only after the core loop is validated): Postgres + Prisma,
  NextAuth, real privacy/deletion design

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
  secrets, keep all persona data client-side only in v0 (no network calls
  that send node content anywhere); write code per the `ponytail` skill —
  no unrequested abstractions, no boilerplate, the first lazy solution that
  works; any UI work follows `DESIGN.md` and is checked against
  `design-taste-frontend`/`web-design-guidelines` before being called done.
- **Ask first**: adding any backend/DB (this is the v0→v1 boundary), adding
  a paid dependency or third-party service, any IndexedDB schema change that
  isn't additive (needs a migration strategy once users have real data).
- **Never**: add auto-posting/social/public-sharing behavior (out of scope),
  send persona content to any third-party service without an explicit user
  action (e.g. the export is copy-to-clipboard, not auto-upload; the one
  exception is AI draft assist, which does send node content to Anthropic —
  only when the user has supplied their own key AND clicked the
  clearly-separate "Draft with AI" action, never automatically); store the
  user's API key anywhere but `localStorage` (no IndexedDB, no cookie, never
  logged to the console, never included in error reports or telemetry);
  send the API key anywhere except directly to `api.anthropic.com`.

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

## Open Questions
1. **Resolved.** v0 is validated once the founder personally builds 5+
   linked persona nodes across 2+ domains and still finds the exported
   context useful two weeks later. Starts v1 (accounts/backend) at that
   point, not before.

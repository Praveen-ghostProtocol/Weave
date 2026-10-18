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

## Tech Stack
- Next.js (App Router) + TypeScript + React — static client app, no server-side DB
- Tailwind CSS
- Local persistence: IndexedDB via Dexie (data never leaves the browser in v0)
- Graph rendering: react-flow, manual layout (user drags/saves node positions,
  no force-directed physics — expected node count per user is small, tens not
  hundreds, so auto-layout is overkill)
- Deployed on Vercel as a static app (no DB, no server cost)
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
  action (e.g. the export is copy-to-clipboard, not auto-upload).

## Success Criteria
- [ ] User can open the app with zero setup and create a persona node (title,
      domain tag, markdown body) — works correctly on a fresh/empty graph.
- [ ] User can link two nodes; link is visible from both sides; relinking the
      same pair is a no-op.
- [ ] Deleting a node removes its edges with it.
- [ ] Graph view renders nodes + edges (manual layout, positions persist),
      clicking a node opens it.
- [ ] User can select nodes (or "all") and export a combined markdown context
      block that includes directly-linked neighbors of selected nodes.
- [ ] Export is disabled when selection is empty.
- [ ] Deployed, reachable via a public URL, works for a first-time visitor
      with zero existing data (empty state doesn't break).
- [ ] UI reviewed by product-manager against `DESIGN.md` and doesn't read as
      generic/templated AI output (default bento grids, stock gradients,
      centered-hero-two-buttons, etc.).

## Open Questions
1. At what point (node count, session count, user feedback) do we call the
   core loop "validated" and start v1 (accounts/backend)? Not blocking v0
   build, but worth a rough answer before v0 ships so we're not guessing.

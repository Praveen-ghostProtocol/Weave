// Domain tag is free-form (tasks/plan.md Open Question 2 — resolved: string,
// not a closed enum; UI may offer autocomplete from previously-used tags).
export type DomainTag = string;

export interface PersonaNode {
  id: string;
  title: string;
  domain: DomainTag;
  body: string; // markdown
  position: { x: number; y: number }; // matches @xyflow/react's node position shape

  // Containment, as a tree. ABSENT means top level — never write `null`,
  // so there is exactly one spelling of "has no parent" to test against.
  //
  // Deliberately a field rather than a typed edge: "Acme contains Sprint
  // rituals" and "Sprint rituals relates to Gym" are different kinds of
  // claim, and folding both into `edges` loses that distinction in every
  // consumer. A field also gives single-parent and no-cycles for free in
  // the shape itself rather than as an invariant something has to police.
  //
  // Additive by design: lib/storage/db.ts persists the whole graph as one
  // JSON blob under a singleton key, so existing records simply read as
  // top level. No Dexie version bump, no migration.
  //
  // Set it ONLY through lib/graph/parent.ts's setParent — it is the one
  // place that checks for cycles. useGraph's updateNode deliberately
  // excludes this field at the type level for that reason.
  parentId?: string;
}

export interface PersonaEdge {
  fromId: string;
  toId: string;
}

export interface PersonaGraph {
  nodes: PersonaNode[];
  edges: PersonaEdge[];
}

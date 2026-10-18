// Domain tag is free-form (tasks/plan.md Open Question 2 — resolved: string,
// not a closed enum; UI may offer autocomplete from previously-used tags).
export type DomainTag = string;

export interface PersonaNode {
  id: string;
  title: string;
  domain: DomainTag;
  body: string; // markdown
  position: { x: number; y: number }; // matches @xyflow/react's node position shape
}

export interface PersonaEdge {
  fromId: string;
  toId: string;
}

export interface PersonaGraph {
  nodes: PersonaNode[];
  edges: PersonaEdge[];
}

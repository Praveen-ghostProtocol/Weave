// Thin Dexie wrapper — whole graph loaded into memory on mount, persisted
// as one record on change (expected node count is tens, not hundreds, per
// plan.md, so no need for per-node queries/pagination).
//
// The Dexie instance is created lazily inside getDB(), not at module load,
// so importing this file during SSR/build (where `indexedDB` doesn't exist)
// never touches IndexedDB. Callers must also guard with `typeof window`.
import Dexie, { type Table } from "dexie";
import type { PersonaGraph } from "@/lib/graph/types";

const SINGLETON_KEY = "graph";

interface GraphRecord {
  id: string;
  graph: PersonaGraph;
}

class WeaveDB extends Dexie {
  graphs!: Table<GraphRecord, string>;
  constructor() {
    super("weave");
    this.version(1).stores({ graphs: "id" });
  }
}

let db: WeaveDB | null = null;
function getDB(): WeaveDB {
  if (!db) db = new WeaveDB();
  return db;
}

export async function loadGraph(): Promise<PersonaGraph> {
  const record = await getDB().graphs.get(SINGLETON_KEY);
  return record?.graph ?? { nodes: [], edges: [] };
}

export async function saveGraph(graph: PersonaGraph): Promise<void> {
  await getDB().graphs.put({ id: SINGLETON_KEY, graph });
}

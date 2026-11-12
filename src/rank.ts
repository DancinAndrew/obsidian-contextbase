// Ranking on top of BM25 (decisions D7 and D8).
//
// BM25 says how well the words match. It cannot tell an old decision from the one that replaced
// it (their scores differed by 0.04 in the plan's example), so the final score multiplies BM25 by
// what the memory note itself says: who decided, how long ago, whether it was replaced, and how
// close it is to where the agent is working. The weights are starting points (assumption M6).

export const WEIGHTS = {
  userDecision: 1.3, // the user decided
  agentDecision: 1.15, // an agent proposed or decided on its own
  fact: 1.1,
  progress: 1.0,
  note: 1.0, // an ordinary note in the vault
  superseded: 0.3,
  halfLifeDays: 30, // a memory's recency bonus halves every 30 days...
  recencyFloor: 0.5, // ...but never drops below half
  scopeAlpha: 0.5,
} as const;

export interface RankFacts {
  kind: "memory" | "note";
  type: string | null;
  decidedBy: string | null;
  created: string | null; // ISO date of a memory
  superseded: boolean;
  location: string | null; // the memory's topic, or a note's folder
}

export function typeWeight(facts: RankFacts): number {
  if (facts.kind === "note") return WEIGHTS.note;
  if (facts.type === "decision") return facts.decidedBy === "user" ? WEIGHTS.userDecision : WEIGHTS.agentDecision;
  if (facts.type === "fact") return WEIGHTS.fact;
  return WEIGHTS.progress;
}

// 1.0 for a memory written now, 0.75 after 30 days, approaching 0.5. Ordinary notes do not decay:
// their content is the user's own and stays true until the user edits it.
export function recencyWeight(facts: RankFacts, now: Date): number {
  if (facts.kind === "note" || !facts.created) return 1;
  const created = Date.parse(facts.created);
  if (Number.isNaN(created)) return 1;
  const ageDays = Math.max(0, (now.getTime() - created) / 86_400_000);
  const floor = WEIGHTS.recencyFloor;
  return floor + (1 - floor) * 0.5 ** (ageDays / WEIGHTS.halfLifeDays);
}

// score × (1 + α × shared levels ÷ levels of the current folder). At the vault root, or when the
// working folder is unknown, location says nothing about the topic, so the factor is 1 (D7).
export function scopeWeight(location: string | null, current: string | null): number {
  if (current === null || current === "" || location === null) return 1;
  const here = current.split("/").filter(Boolean);
  const there = location.split("/").filter(Boolean);
  if (current.startsWith("/") !== location.startsWith("/")) return 1;
  let shared = 0;
  while (shared < here.length && shared < there.length && here[shared] === there[shared]) shared++;
  return 1 + WEIGHTS.scopeAlpha * (shared / here.length);
}

export function finalScore(relevance: number, facts: RankFacts, current: string | null, now: Date): number {
  const superseded = facts.superseded ? WEIGHTS.superseded : 1;
  return relevance * typeWeight(facts) * recencyWeight(facts, now) * scopeWeight(facts.location, current) * superseded;
}

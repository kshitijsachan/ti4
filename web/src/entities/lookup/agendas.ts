import { agendas } from "@/entities/data/agendas";
import { indexBy } from "@/entities/lookup/indexBy";
import type { Agenda } from "@/entities/data/types";

const agendasMap = indexBy(agendas, (a) => a.alias);

/** "minister_commerce" / "Minister of Commerce" → "ministercommerce". */
const squash = (s: string) => s.toLowerCase().replace(/\b(of|the)\b/g, "").replace(/[^a-z]/g, "");

/** Official cards first, so a homebrew namesake never shadows them. */
const byName = new Map<string, Agenda>();
for (const a of [...agendas].sort((x, y) => Number(x.source !== "base" && x.source !== "pok") - Number(y.source !== "base" && y.source !== "pok"))) {
  if (!byName.has(squash(a.name))) byName.set(squash(a.name), a);
}

/** An agenda by its id; ids that drifted from the generated data (renamed aliases) fall back to the card name. */
export function getAgendaData(alias: string): Agenda | undefined {
  return agendasMap.get(alias) ?? byName.get(squash(alias));
}

import { agendas } from "@/entities/data/agendas";
import { indexBy } from "@/entities/lookup/indexBy";
import type { Agenda } from "@/entities/data/types";

const agendasMap = indexBy(agendas, (a) => a.alias);

export function getAgendaData(alias: string): Agenda | undefined {
  return agendasMap.get(alias);
}

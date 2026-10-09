import type { UndoPoint } from "./types";

const PHASES: Record<string, string> = {
  strategy: "strategy",
  action: "action",
  agenda: "agenda",
  agendawaiting: "agenda",
  statusScoring: "status",
  statusHomework: "status",
  playerSetup: "setup",
  miltydraft: "draft",
};

/** `R2 action · 23:01` */
export function formatSaveTime(p: UndoPoint): string {
  const d = new Date(p.savedAt);
  const clock = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const phase = PHASES[p.phase] ?? (p.phase.toLowerCase().startsWith("status") ? "status" : p.phase);
  const where = p.round > 0 ? `R${p.round}${phase ? ` ${phase}` : ""}` : phase;
  return [where, clock].filter(Boolean).join(" · ");
}

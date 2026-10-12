import { useFactionBundles, loadExtended } from "../data";
import { buildFactionSheet } from "../model";
import { FactionSheet } from "../FactionSheet";
import type { FactionBundle } from "../types";

/** Data gaps per faction: what a sheet would be missing. */
function gaps(alias: string, bundle: FactionBundle): string[] {
  const m = buildFactionSheet(alias, bundle);
  if (!m) return ["no faction"];
  const out: string[] = [];
  if (!m.headlineUnits.some((e) => e.base.baseType === "flagship")) out.push("flagship");
  if (!m.headlineUnits.some((e) => e.base.baseType === "mech")) out.push("mech");
  if (!m.abilities.length) out.push("abilities");
  m.abilities.filter((a) => "missing" in a).forEach((a) => out.push(`ability ${a.id}`));
  if (m.leaders.length < 3) out.push(`leaders (${m.leaders.length})`);
  m.leaders.filter((e) => !e.leader.abilityText).forEach((e) => out.push(`leader text ${e.leader.id}`));
  if (m.techs.length < 2) out.push(`faction techs (${m.techs.length})`);
  if (!m.promissoryNotes.length) out.push("promissory note");
  if (!m.breakthrough) out.push("breakthrough");
  if (!m.homePlanets.length) out.push("home planets");
  if (m.commodities === undefined) out.push("commodities");
  const expected = (m.info.leaders?.length ?? 0) + (m.info.factionTech?.length ?? 0) + (m.info.promissoryNotes?.length ?? 0);
  const found = m.leaders.length + m.techs.length + m.promissoryNotes.length;
  if (found < expected) out.push(`unresolved ids (${expected - found})`);
  return out;
}

export function Gallery({ all }: { all: boolean }) {
  const loaded = useFactionBundles();
  if (all && loaded && !loaded.extended) void loadExtended();
  if (!loaded) return <div style={{ padding: 24, color: "#888" }}>loading…</div>;
  const bundles = all && loaded.extended ? [loaded.official, loaded.extended] : [loaded.official];
  const rows = bundles.flatMap((b) =>
    Object.values(b.factions).map((f) => ({ alias: f.alias, name: f.factionName, source: f.source, gaps: gaps(f.alias, { ...b, units: { ...loaded.official.units, ...b.units }, techs: { ...loaded.official.techs, ...b.techs } }) })),
  );
  const withGaps = rows.filter((r) => r.gaps.length);
  return (
    <div style={{ padding: 24, fontFamily: "var(--font-text)", fontSize: 12, color: "#ccc" }}>
      <h2 style={{ fontFamily: "var(--font-display)" }}>
        {rows.length} factions · {withGaps.length} with gaps
      </h2>
      <table id="gaps" style={{ borderCollapse: "collapse", marginBottom: 32 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.alias} style={{ borderBottom: "1px solid #333" }}>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <a href={`?faction=${r.alias}`} style={{ color: "#9cf" }}>{r.alias}</a>
              </td>
              <td style={{ padding: "2px 12px 2px 0" }}>{r.name}</td>
              <td style={{ padding: "2px 12px 2px 0", color: "#888" }}>{r.source}</td>
              <td style={{ color: r.gaps.length ? "#f87171" : "#4ade80" }}>{r.gaps.join(", ") || "ok"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))", gap: 32 }}>
          {rows.map((r) => (
            <div key={r.alias} style={{ border: "1px solid #222", padding: 12 }}>
              <FactionSheet faction={r.alias} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

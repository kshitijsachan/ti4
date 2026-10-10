import { IconMinus, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import type { PlayConnection } from "@/discord";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { cdnImage } from "@/entities/data/cdnImage";
import { getColorAlias, getPrimaryColorCSS } from "@/entities/lookup/colors";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Scope } from "./driver";
import { commitLanding, type LandingOffer } from "./landing";
import { useMapActions } from "./store";
import classes from "./MapActions.module.css";

const UNIT_NAMES: Record<string, string> = { gf: "Infantry", mf: "Mech" };

type Props = {
  target: string;
  targetName?: string;
  offer: LandingOffer;
  me: PlayerData;
  web?: PlayerDataResponse;
  conn: PlayConnection;
  scope: Scope;
  prompt: { channelId: string; messageId: string };
  busy: string | null;
  error: string | null;
  run: (work: () => Promise<void>) => Promise<void>;
  setBusy: (text: string | null) => void;
  onHandBack: () => void;
};

/** My ground forces in the active system's space, by unit. */
function inSpace(target: string, me: PlayerData, web?: PlayerDataResponse) {
  const out: Record<string, number> = {};
  for (const e of web?.tileUnitData?.[target]?.space?.[me.faction] ?? []) {
    if (e.entityType === "unit" && (e.entityId === "gf" || e.entityId === "mf"))
      out[e.entityId] = e.count;
  }
  return out;
}

/** Who holds a planet and with how many ground forces. */
function planetState(
  target: string,
  planet: string,
  me: PlayerData,
  web?: PlayerDataResponse,
) {
  const p = web?.tileUnitData?.[target]?.planets?.[planet];
  const owner = web?.playerData.find(
    (x) => x.faction === p?.controlledBy || x.color === p?.controlledBy,
  );
  let mine = 0;
  let theirs = 0;
  for (const [faction, list] of Object.entries(p?.entities ?? {})) {
    const n = list
      .filter(
        (e) =>
          e.entityType === "unit" &&
          (e.entityId === "gf" || e.entityId === "mf"),
      )
      .reduce((a, e) => a + e.count, 0);
    if (faction === me.faction) mine += n;
    else theirs += n;
  }
  return { owner, mine, theirs };
}

/** The landing step: each planet of the activated system with a stepper per ground unit, and one Land. */
export function LandingPanel({
  target,
  targetName,
  offer,
  me,
  web,
  conn,
  scope,
  prompt,
  busy,
  error,
  run,
  setBusy,
  onHandBack,
}: Props) {
  const plan = useMapActions((s) => s.landing);
  const setLanding = useMapActions((s) => s.setLanding);
  const space = inSpace(target, me, web);
  const units = Object.keys(offer.units);
  const assigned = (unit: string) =>
    offer.planets.reduce((a, p) => a + (plan[p]?.[unit] ?? 0), 0);
  const left = (unit: string) => (space[unit] ?? 0) - assigned(unit);
  const total = units.reduce((a, u) => a + assigned(u), 0);
  const set = (planet: string, unit: string, n: number) =>
    setLanding((p) => ({
      ...p,
      [planet]: { ...(p[planet] ?? {}), [unit]: Math.max(0, n) },
    }));

  const land = () =>
    run(() =>
      commitLanding(
        Object.fromEntries(
          Object.entries(plan).map(([planet, u]) => [
            planet,
            Object.fromEntries(
              Object.entries(u).filter(
                ([unit, n]) => n > 0 && offer.units[unit]?.includes(planet),
              ),
            ),
          ]),
        ),
        { conn, scope, prompt, onProgress: setBusy },
      ).then(() => setLanding(() => ({}))),
    );

  return (
    <>
      <div className={classes.barHead}>
        <span className={classes.barTitle}>
          Land ground forces · {targetName || "system"}
        </span>
        <span className={cx(classes.mono, classes.muted)}>{target}</span>
        <span className={classes.grow} />
        <button
          type="button"
          className={classes.link}
          onClick={onHandBack}
          disabled={!!busy}
        >
          Use the game's buttons
        </button>
      </div>
      <div className={classes.planets}>
        {offer.planets.map((planet) => {
          const data = getPlanetData(planet);
          const st = planetState(target, planet, me, web);
          return (
            <div key={planet} className={classes.planet}>
              <div>
                <div className={classes.planetName}>
                  <span
                    className={classes.dot}
                    style={{
                      background: st.owner
                        ? getPrimaryColorCSS(st.owner.color)
                        : "transparent",
                    }}
                    title={
                      st.owner
                        ? `Controlled by ${st.owner.userName}`
                        : "Uncontrolled"
                    }
                  />
                  {data?.name ?? planet}
                </div>
                <div className={classes.planetMeta}>
                  {data && (
                    <span className={classes.mono}>
                      {data.resources}/{data.influence}
                    </span>
                  )}
                  <span>
                    {st.owner
                      ? st.owner.faction === me.faction
                        ? "yours"
                        : st.owner.userName
                      : "uncontrolled"}
                  </span>
                  {st.theirs > 0 && (
                    <span className={classes.slow}>{st.theirs} defending</span>
                  )}
                  {st.mine > 0 && <span>{st.mine} of yours there</span>}
                </div>
              </div>
              <div className={classes.steppers}>
                {units
                  .filter((u) => offer.units[u].includes(planet))
                  .map((unit) => {
                    const n = plan[planet]?.[unit] ?? 0;
                    return (
                      <div key={unit} className={classes.stepper}>
                        <img
                          src={cdnImage(
                            `/units/${getColorAlias(me.color)}_${unit}.png`,
                          )}
                          alt={UNIT_NAMES[unit] ?? unit}
                          title={UNIT_NAMES[unit] ?? unit}
                        />
                        <button
                          type="button"
                          className={cx(classes.iconButton, classes.step)}
                          disabled={!n || !!busy}
                          onClick={() => set(planet, unit, n - 1)}
                          aria-label={`One less ${UNIT_NAMES[unit] ?? unit} on ${data?.name ?? planet}`}
                        >
                          <IconMinus size={12} />
                        </button>
                        <span className={classes.count}>{n}</span>
                        <button
                          type="button"
                          className={cx(classes.iconButton, classes.step)}
                          disabled={left(unit) <= 0 || !!busy}
                          onClick={() => set(planet, unit, n + 1)}
                          aria-label={`One more ${UNIT_NAMES[unit] ?? unit} on ${data?.name ?? planet}`}
                        >
                          <IconPlus size={12} />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
      <div className={classes.spaceRow}>
        Staying in space:
        {units.map((u) => (
          <span key={u} className={classes.mono}>
            {Math.max(0, left(u))} {UNIT_NAMES[u] ?? u}
          </span>
        ))}
      </div>
      {busy && <div className={classes.barText}>{busy}</div>}
      {error && <div className={classes.error}>{error}</div>}
      <div className={classes.barActions}>
        <button
          type="button"
          className={cx(classes.button, classes.primary)}
          onClick={() => void land()}
          disabled={!!busy}
        >
          {total ? `Land ${total}` : "Don't land"}
        </button>
        <button
          type="button"
          className={classes.button}
          onClick={() => setLanding(() => ({}))}
          disabled={!!busy || !total}
        >
          Clear
        </button>
      </div>
    </>
  );
}

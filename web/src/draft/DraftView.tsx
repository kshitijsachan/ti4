import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cx from "clsx";
import type {
  DraftChoice,
  DraftOrderOption,
  DraftPickHandler,
  DraftState,
  PickCategory,
} from "./types";
import { useDraftState } from "./useDraftState";
import {
  availability,
  playerById,
  seatOf,
  withPending,
  type Focus,
  type PendingPick,
} from "./model";
import { SliceCard } from "./components/SliceCard";
import { FactionCard } from "./components/FactionCard";
import { OrderPicker } from "./components/OrderPicker";
import { PickTracker } from "./components/PickTracker";
import { DraftBoard } from "./components/DraftBoard";
import { GalaxyPreview } from "./components/GalaxyPreview";
import { FactionInspector, SliceInspector } from "./components/Inspector";
import { PlayerTag } from "./components/PlayerTag";
import { PickButton } from "./components/PickButton";
import classes from "./Draft.module.css";

export type DraftViewProps = {
  gameName: string;
  /** The viewer's Discord user id (the shim's `hello.me.id`). */
  myUserId: string;
  /** Press the bot button for a pick. Wire it to the shim socket's `click` op. */
  onPick: DraftPickHandler;
  /** Where the bot API is mounted in the browser. Defaults to the shim's `/bot` proxy. */
  botBase?: string;
  /** Bump to refetch immediately (e.g. when the app sees a new message in the draft channel). */
  refreshSignal?: unknown;
  className?: string;
};

const SYSTEM_LABEL: Record<string, string> = {
  milty: "Milty draft",
  draft: "Draft",
};

/**
 * The draft as one readout: every slice side by side with real tile art and totals, the faction pool, speaker
 * order, the snake with whoever is on the clock, and a pick affordance that only lights on your turn. Picks go
 * through the bot's own buttons via `onPick`, so the bot stays the rules engine.
 */
export function DraftView({
  gameName,
  myUserId,
  onPick,
  botBase = "/bot",
  refreshSignal,
  className,
}: DraftViewProps) {
  const {
    draft: served,
    error: loadError,
    loading,
    refresh,
  } = useDraftState(gameName, { botBase });
  const [pending, setPending] = useState<
    (PendingPick & { baseIndex: number; at: number }) | null
  >(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [hover, setHover] = useState<Focus>(null);
  const [pinned, setPinned] = useState<Focus>(null);
  const firstSignal = useRef(true);

  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    refresh();
  }, [refreshSignal, refresh]);

  useEffect(() => {
    if (!pending || !served) return;
    const confirmed =
      served.pickIndex > pending.baseIndex ||
      allChoices(served).some(
        (c) => c.customId === pending.customId && c.pickedBy,
      );
    if (confirmed) setPending(null);
  }, [served, pending]);

  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setPending(null), 12000);
    return () => window.clearTimeout(t);
  }, [pending]);

  const draft = useMemo(
    () => (served ? withPending(served, myUserId, pending) : null),
    [served, myUserId, pending],
  );

  const pick = useCallback(
    async (category: PickCategory, choice: DraftChoice) => {
      if (!served || !choice.customId || !choice.channelId || !choice.messageId)
        return;
      setPickError(null);
      setPending({
        category,
        key: choice.key,
        customId: choice.customId,
        baseIndex: served.pickIndex,
        at: Date.now(),
      });
      try {
        const result = await onPick(
          choice.customId,
          choice.channelId,
          choice.messageId,
        );
        const err =
          result && typeof result === "object" && "error" in result
            ? (result as { error?: string }).error
            : undefined;
        if (err) throw new Error(err);
      } catch (e) {
        setPending(null);
        setPickError(e instanceof Error ? e.message : String(e));
      } finally {
        refresh();
      }
    },
    [served, onPick, refresh],
  );

  if (!draft) {
    return (
      <div className={cx(classes.root, classes.emptyState, className)}>
        <span className={classes.railLabel}>Draft</span>
        <span>
          {loading ? "Reading the draft…" : (loadError ?? "No draft data")}
        </span>
      </div>
    );
  }

  if (draft.status === "none") {
    return (
      <div className={cx(classes.root, classes.emptyState, className)}>
        <span className={classes.railLabel}>Draft · {draft.game}</span>
        <span>
          No draft is running in this game yet. Start one from the game's setup
          buttons.
        </span>
      </div>
    );
  }

  const focus = pinned ?? hover;
  const me = playerById(draft, myUserId);
  const current = playerById(draft, draft.currentPlayer);
  const myTurn =
    draft.status === "drafting" && draft.currentPlayer === myUserId && !pending;
  const avail = (category: PickCategory, choice: DraftChoice) =>
    availability(draft, myUserId, category, choice, pending);
  const focusedSlice =
    focus?.kind === "slice"
      ? draft.slices.find((s) => s.name === focus.key)
      : undefined;
  const focusedFaction =
    focus?.kind === "faction"
      ? draft.factions.find((f) => f.alias === focus.key)
      : undefined;
  const focusedOrder =
    focus?.kind === "order" || focus?.kind === "seat"
      ? Number(focus.key.replace(/\D/g, "")) || null
      : null;
  const previewSeat = focusedOrder ?? seatOf(draft, me) ?? null;
  const ghostSlice =
    focusedSlice && !focusedSlice.choice.pickedBy ? focusedSlice : undefined;

  const setFocus = (f: Focus, pin: boolean) => {
    if (pin)
      setPinned((cur) =>
        cur && f && cur.kind === f.kind && cur.key === f.key ? null : f,
      );
    else setHover(f);
  };
  const homeImageFor = (sliceName: string) => {
    const owner = draft.players.find((p) => p.slice === sliceName);
    const faction =
      owner && draft.factions.find((f) => f.alias === owner.faction);
    return faction?.homeSystemImage ?? null;
  };
  const openSlices = draft.slices.filter((s) => !s.choice.pickedBy).length;
  const openFactions = draft.factions.filter((f) => !f.choice.pickedBy).length;

  return (
    <div className={cx(classes.root, className)}>
      <header className={cx(classes.header, myTurn && classes.headerMyTurn)}>
        <div className={classes.headerTitle}>
          <span className={classes.railLabel}>
            {SYSTEM_LABEL[draft.system ?? ""] ?? "Draft"}
          </span>
          <span className={classes.headerGame}>{draft.game}</span>
          {draft.mapTemplate && (
            <span className={classes.headerMeta}>
              {draft.mapTemplate.alias}
            </span>
          )}
        </div>
        <div className={classes.headerClock}>
          {draft.status === "finished" ? (
            <span className={classes.finishedBadge}>Draft complete</span>
          ) : (
            <>
              <span className={classes.statLabel}>On the clock</span>
              {current && (
                <PlayerTag
                  player={current}
                  draft={draft}
                  className={classes.clockTag}
                />
              )}
              {myTurn && <span className={classes.yourTurn}>Your pick</span>}
              {pending && (
                <span className={classes.sendingBadge}>Sending…</span>
              )}
            </>
          )}
        </div>
        <div className={classes.headerCounter}>
          <span className={classes.statLabel}>Pick</span>
          <span className={classes.counterNum}>
            {Math.min(draft.pickIndex + 1, draft.pickOrder.length)}
            <span className={classes.counterOf}>/{draft.pickOrder.length}</span>
          </span>
        </div>
      </header>

      <PickTracker draft={draft} myUserId={myUserId} />

      {(pickError || loadError) && (
        <div className={classes.alert} role="alert">
          <span>{pickError ?? `Connection: ${loadError}`}</span>
          {pickError && (
            <button
              type="button"
              className={classes.alertClose}
              onClick={() => setPickError(null)}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className={classes.layout}>
        <main className={classes.main}>
          <section className={classes.section}>
            <h3 className={classes.sectionTitle}>
              Slices{" "}
              <span className={classes.sectionCount}>
                {openSlices} open / {draft.slices.length}
              </span>
            </h3>
            <div className={classes.sliceGrid}>
              {draft.slices.map((s) => (
                <SliceCard
                  key={s.name}
                  draft={draft}
                  slice={s}
                  availability={avail("slice", s.choice)}
                  focused={focus?.kind === "slice" && focus.key === s.name}
                  pending={pending?.customId === s.choice.customId}
                  botBase={botBase}
                  owner={playerById(draft, s.choice.pickedBy)}
                  ownerHomeImage={homeImageFor(s.name)}
                  onFocus={(pin) =>
                    setFocus({ kind: "slice", key: s.name }, pin)
                  }
                  onBlur={() => setHover(null)}
                  onPick={() => void pick("slice", s.choice)}
                />
              ))}
            </div>
          </section>

          {draft.factions.length > 0 && (
            <section className={classes.section}>
              <h3 className={classes.sectionTitle}>
                Factions{" "}
                <span className={classes.sectionCount}>
                  {openFactions} open / {draft.factions.length}
                </span>
              </h3>
              <div className={classes.factionGrid}>
                {draft.factions.map((f) => (
                  <FactionCard
                    key={f.alias}
                    draft={draft}
                    faction={f}
                    availability={avail("faction", f.choice)}
                    focused={focus?.kind === "faction" && focus.key === f.alias}
                    pending={pending?.customId === f.choice.customId}
                    owner={playerById(draft, f.choice.pickedBy)}
                    onFocus={(pin) =>
                      setFocus({ kind: "faction", key: f.alias }, pin)
                    }
                    onBlur={() => setHover(null)}
                    onPick={() => void pick("faction", f.choice)}
                  />
                ))}
              </div>
            </section>
          )}

          {draft.speakerOrder.length > 0 && (
            <OrderSection
              draft={draft}
              title="Speaker order"
              options={draft.speakerOrder}
              kind="order"
              pending={pending}
              focus={focus}
              avail={(o) => avail("speakerOrder", o.choice)}
              setFocus={setFocus}
              setHover={setHover}
              onPick={(o) => void pick("speakerOrder", o.choice)}
            />
          )}
          {draft.seats.length > 0 && (
            <OrderSection
              draft={draft}
              title="Seats"
              options={draft.seats}
              kind="seat"
              pending={pending}
              focus={focus}
              avail={(o) => avail("seat", o.choice)}
              setFocus={setFocus}
              setHover={setHover}
              onPick={(o) => void pick("seat", o.choice)}
            />
          )}
          {draft.otherCategories.map((cat) => (
            <section key={cat.type} className={classes.section}>
              <h3 className={classes.sectionTitle}>{cat.label}</h3>
              <div className={classes.otherGrid}>
                {cat.choices.map((c) => (
                  <div
                    key={c.key}
                    className={cx(
                      classes.plate,
                      classes.otherChoice,
                      c.pickedBy && classes.taken,
                    )}
                  >
                    <span className={classes.otherLabel}>{c.label}</span>
                    {c.pickedBy ? (
                      <PlayerTag
                        player={playerById(draft, c.pickedBy)!}
                        draft={draft}
                        compact
                      />
                    ) : (
                      <PickButton
                        label="Pick"
                        size="sm"
                        availability={avail(cat.type, c)}
                        pending={pending?.customId === c.customId}
                        onPick={() => void pick(cat.type, c)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </main>

        <aside className={classes.aside}>
          <section className={cx(classes.plate, classes.asidePanel)}>
            <header className={classes.rail}>
              <span className={classes.railLabel}>Draft board</span>
            </header>
            <DraftBoard
              draft={draft}
              myUserId={myUserId}
              onFocusSlice={(name) =>
                setFocus({ kind: "slice", key: name }, true)
              }
              onFocusFaction={(alias) =>
                setFocus({ kind: "faction", key: alias }, true)
              }
            />
          </section>

          <section className={cx(classes.plate, classes.asidePanel)}>
            <header className={classes.rail}>
              <span className={classes.railLabel}>Inspector</span>
              <span className={classes.railSpacer} />
              {pinned && (
                <button
                  type="button"
                  className={classes.railButton}
                  onClick={() => setPinned(null)}
                >
                  Unpin
                </button>
              )}
            </header>
            {focusedSlice ? (
              <SliceInspector
                draft={draft}
                slice={focusedSlice}
                botBase={botBase}
              />
            ) : focusedFaction ? (
              <FactionInspector
                draft={draft}
                faction={focusedFaction}
                botBase={botBase}
              />
            ) : (
              <p className={classes.inspectorHint}>
                Hover a slice or faction to read it here. Click to pin.
              </p>
            )}
          </section>
          {draft.mapTemplate && (
            <section className={cx(classes.plate, classes.asidePanel)}>
              <header className={classes.rail}>
                <span className={classes.railLabel}>Galaxy</span>
                <span className={classes.railSpacer} />
                <span className={classes.railMeta}>
                  {previewSeat != null
                    ? ghostSlice
                      ? `Slice ${ghostSlice.name} in seat ${previewSeat}`
                      : `Seat ${previewSeat}`
                    : "Pick a position to preview your seat"}
                </span>
              </header>
              <div className={classes.galaxyWrap}>
                <GalaxyPreview
                  draft={draft}
                  botBase={botBase}
                  width={318}
                  seat={previewSeat}
                  ghostSlice={ghostSlice}
                />
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

type OrderSectionProps = {
  draft: DraftState;
  title: string;
  options: DraftOrderOption[];
  kind: "order" | "seat";
  pending: PendingPick | null;
  focus: Focus;
  avail: (o: DraftOrderOption) => ReturnType<typeof availability>;
  setFocus: (f: Focus, pin: boolean) => void;
  setHover: (f: Focus) => void;
  onPick: (o: DraftOrderOption) => void;
};

function OrderSection({
  draft,
  title,
  options,
  kind,
  pending,
  focus,
  avail,
  setFocus,
  setHover,
  onPick,
}: OrderSectionProps) {
  const open = options.filter((o) => !o.choice.pickedBy).length;
  return (
    <section className={classes.section}>
      <h3 className={classes.sectionTitle}>
        {title}{" "}
        <span className={classes.sectionCount}>
          {open} open / {options.length}
        </span>
      </h3>
      <OrderPicker
        draft={draft}
        options={options}
        kind={kind}
        availabilityOf={avail}
        pendingKey={
          pending && options.some((o) => o.choice.customId === pending.customId)
            ? pending.key
            : null
        }
        focusedKey={focus?.kind === kind ? focus.key : null}
        onFocus={(key, pin) =>
          key ? setFocus({ kind, key }, pin) : setHover(null)
        }
        onPick={onPick}
      />
    </section>
  );
}

function allChoices(d: DraftState): DraftChoice[] {
  return [
    ...d.slices.map((s) => s.choice),
    ...d.factions.map((f) => f.choice),
    ...d.speakerOrder.map((o) => o.choice),
    ...d.seats.map((o) => o.choice),
    ...d.otherCategories.flatMap((c) => c.choices),
  ];
}

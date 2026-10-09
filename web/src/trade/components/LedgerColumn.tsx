import cx from "clsx";
import type { ReactNode } from "react";
import { FRAGMENT_COLOR, FRAGMENT_LABEL, ICONS } from "../icons";
import { ANY_PN, FRAGMENT_TRAITS, sideCount, type SideDraft, type SideLimits } from "../model";
import type { CardRef, TradeCounterparty, TradeSelf } from "../types";
import classes from "../Trade.module.css";
import { CardChip } from "./CardChip";
import { Stepper } from "./Stepper";

type Props = {
  mode: "give" | "receive";
  side: SideDraft;
  limits: SideLimits;
  me: TradeSelf;
  cp: TradeCounterparty;
  onChange: (next: SideDraft) => void;
};

function Row({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={classes.row}>
      <span className={classes.rowLabel}>
        {icon}
        {label}
      </span>
      <div className={classes.rowBody}>{children}</div>
    </div>
  );
}

const img = (src: string) => <img className={classes.rowIcon} src={src} alt="" />;

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** One side of the ledger: what you give, or what you ask for. */
export function LedgerColumn({ mode, side, limits, me, cp, onChange }: Props) {
  const give = mode === "give";
  const set = (patch: Partial<SideDraft>) => onChange({ ...side, ...patch });
  const count = sideCount(side);
  const holder = give ? me : cp;
  const commsBlocked = give ? !me.canSendCommodities : !cp.canSendCommodities;
  const pnOptions: CardRef[] = give ? me.promissoryNotes : cp.requestablePromissoryNotes;
  const relics = give ? me.relics : cp.relics;
  const anyFragments = FRAGMENT_TRAITS.some((t) => limits.fragments[t] > 0);

  return (
    <section className={classes.column} aria-label={give ? "You give" : "You get"}>
      <header className={classes.columnHead}>
        <span className={classes.columnTitle}>{give ? "You give" : "You get"}</span>
        <span className={classes.arrow}>{give ? "→" : "←"}</span>
        <span className={classes.columnWho}>{cp.userName}</span>
        <span className={cx(classes.countBadge, count > 0 && classes.countBadgeOn)}>{count}</span>
      </header>
      <div className={classes.rows}>
        <Row label="Trade goods" icon={img(ICONS.tg)}>
          <Stepper label="trade goods" value={side.tg} max={limits.tg} onChange={(tg) => set({ tg })} />
          {!give && <span className={classes.stepHint}>{holder.tg} held</span>}
        </Row>
        <Row label="Commodities" icon={img(ICONS.comm)}>
          {commsBlocked ? (
            <span className={classes.rowEmpty}>Military Industrial Complex: not tradeable</span>
          ) : (
            <>
              <Stepper
                label="commodities"
                value={side.commodities}
                max={limits.commodities}
                onChange={(commodities) => set({ commodities })}
              />
              {side.commodities > 0 && (
                <span className={classes.stepHint}>arrive as trade goods</span>
              )}
            </>
          )}
        </Row>
        <Row label="Promissory" icon={img(ICONS.pn)}>
          {pnOptions.length === 0 && give && <span className={classes.rowEmpty}>None in hand</span>}
          {pnOptions.map((pn) => {
            const excluded = give && cp.excludedGivePromissoryNotes.includes(pn.id);
            return (
              <CardChip
                key={pn.id}
                name={pn.name}
                text={pn.text}
                ownerColor={pn.ownerColor}
                selected={side.promissoryNote === pn.id}
                disabled={excluded}
                disabledReason="They have Hubris: no Alliance"
                onToggle={() =>
                  set({ promissoryNote: side.promissoryNote === pn.id ? null : pn.id })
                }
              />
            );
          })}
          {!give && (
            <CardChip
              name="Any (their pick)"
              text="Ask for a promissory note of their choosing — e.g. one they hold from another player. Discuss which in the note."
              accent="var(--t-pn)"
              selected={side.promissoryNote === ANY_PN}
              onToggle={() =>
                set({ promissoryNote: side.promissoryNote === ANY_PN ? null : ANY_PN })
              }
            />
          )}
        </Row>
        <Row label="Action cards">
          {!cp.canTradeActionCards && (
            <span className={classes.rowEmpty}>Not tradeable (needs Arbiters or Guild Ships)</span>
          )}
          {cp.canTradeActionCards && give && me.actionCards.length === 0 && (
            <span className={classes.rowEmpty}>None in hand</span>
          )}
          {cp.canTradeActionCards &&
            give &&
            me.actionCards.map((ac) => (
              <CardChip
                key={ac.id}
                name={ac.name}
                text={ac.text}
                accent="var(--t-ac)"
                selected={side.actionCards.includes(ac.id)}
                onToggle={() => set({ actionCards: toggle(side.actionCards, ac.id) })}
              />
            ))}
          {cp.canTradeActionCards && !give && (
            <>
              <Stepper
                label="action cards"
                value={side.actionCardCount}
                max={limits.actionCardCount}
                onChange={(actionCardCount) => set({ actionCardCount })}
              />
              <span className={classes.stepHint}>they choose which</span>
            </>
          )}
        </Row>
        {anyFragments && (
          <Row label="Fragments">
            <span className={classes.fragGrid}>
              {FRAGMENT_TRAITS.filter((t) => limits.fragments[t] > 0).map((t) => (
                <span key={t} className={classes.fragCell} title={`${t} relic fragments`}>
                  <span className={classes.swatch} style={{ background: FRAGMENT_COLOR[t] }} />
                  <span className={classes.stepHint}>{FRAGMENT_LABEL[t]}</span>
                  <Stepper
                    label={`${t} fragments`}
                    value={side.fragments[t]}
                    max={limits.fragments[t]}
                    onChange={(n) => set({ fragments: { ...side.fragments, [t]: n } })}
                  />
                </span>
              ))}
            </span>
          </Row>
        )}
        {relics.length > 0 && (
          <Row label="Relics" icon={img(ICONS.relic)}>
            {relics.map((r) => (
              <CardChip
                key={r.id}
                name={r.name}
                text={r.text}
                accent="var(--t-relic)"
                selected={side.relics.includes(r.id)}
                onToggle={() => set({ relics: toggle(side.relics, r.id) })}
              />
            ))}
          </Row>
        )}
        <Row label="Debt">
          <span className={classes.fragCell} title={give ? "You take on debt to them" : "They take on debt to you"}>
            <span className={classes.stepHint}>Send</span>
            <Stepper
              label="debt to send"
              value={side.sendDebt}
              max={limits.sendDebt}
              showMax={false}
              onChange={(sendDebt) => set({ sendDebt })}
            />
          </span>
          {limits.clearDebt > 0 && (
            <span className={classes.fragCell} title={give ? "Forgive their debt you hold" : "They forgive your debt"}>
              <span className={classes.stepHint}>Clear</span>
              <Stepper
                label="debt to clear"
                value={side.clearDebt}
                max={limits.clearDebt}
                onChange={(clearDebt) => set({ clearDebt })}
              />
            </span>
          )}
        </Row>
      </div>
    </section>
  );
}

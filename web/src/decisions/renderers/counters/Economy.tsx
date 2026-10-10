import { useState } from "react";
import { cdnImage } from "@/entities/data/cdnImage";
import { baseId, type Choice } from "../../model/controls";
import { ChoiceButtons } from "../../ui/ChoiceButtons";
import { Prose } from "../../ui/parts";
import { Quantity, QuantityConfirm, QuantityTotal, RunError, RunProgress, useAnyRunning, useRunning } from "../../ui/Quantity";
import { pressOn, pressTimes, usePressPlan, type PlanStep } from "../../ui/pressPlan";
import type { RendererProps } from "../types";
import classes from "./counters.module.css";

const DONE = /^deleteButtons/;
const GAIN = /^(?:gainComms_(\d+)_stay|gain_(\d+)_comms_stay)$/;
const CONVERT = /^(?:convertComms_(\d+)_stay|convert_(\d+)_comms_stay)$/;

/** What `each`-sized presses can reach up to `cap` (the bot caps the last one: 2 at a time with 3 room → 0, 2, 3). */
function ladder(each: number, cap: number) {
  const out = [0];
  for (let n = each; each > 0 && n < cap; n += each) out.push(n);
  if (cap > 0) out.push(cap);
  return out;
}

const amountOf = (id: string, re: RegExp) => {
  const m = id.match(re);
  return m ? Number(m[1] ?? m[2]) : 0;
};

/** A repeatable "Gain N commodities / Convert N commodities … Done Resolving" prompt (Scrap Metal, Free Trade, …). */
export function isCommodityStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => GAIN.test(id) || CONVERT.test(id)) && ids.some((id) => DONE.test(id));
}

/**
 * Gaining and converting commodities in one panel: how many to gain and how many to turn into trade goods, the
 * stores before → after, and one confirm that presses the bot's buttons that many times (gains first, so a gained
 * commodity can be converted), then Done.
 */
export function CommodityBody({ d, data }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning(`counter:comm:${d.id}`);
  const gainBtn = d.choices.find((c) => GAIN.test(baseId(c.customId)));
  const convertBtn = d.choices.find((c) => CONVERT.test(baseId(c.customId)));
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)));
  const gainEach = gainBtn ? amountOf(baseId(gainBtn.customId), GAIN) : 0;
  const convertEach = convertBtn ? amountOf(baseId(convertBtn.customId), CONVERT) : 0;
  const comms = data.me?.commodities ?? 0;
  const limit = data.me?.commoditiesTotal ?? comms;
  const tg = data.me?.tg ?? 0;
  const [gain, setGain] = useState(0);
  const [convert, setConvert] = useState(0);
  const roomFor = Math.max(0, limit - comms);
  const gainMax = gainEach ? roomFor : 0;
  const after = Math.min(limit, comms + gain);
  const convertMax = convertEach ? after : 0;
  const shownConvert = Math.min(convert, convertMax);
  const pressesFor = (n: number, each: number) => (each ? Math.ceil(n / each) : 0);

  const confirm = () => {
    const ch = d.prompt.channelId;
    const g = pressesFor(gain, gainEach);
    const c = pressesFor(shownConvert, convertEach);
    const steps: PlanStep[] = [
      ...pressTimes(ch, d.id, (i) => `Gaining commodities (${i + 1}/${g})`, (id) => GAIN.test(id), g),
      ...pressTimes(ch, d.id, (i) => `Converting commodities (${i + 1}/${c})`, (id) => CONVERT.test(id), c),
    ];
    if (done) steps.push(pressOn(ch, d.id, "Done", (id) => DONE.test(id)));
    void plan(`counter:comm:${d.id}`, steps);
  };

  const text = d.text.replace(/\s*use (?:the |these )?buttons[^.]*\.?/i, "").trim();
  return (
    <div className={classes.panel}>
      {text && <Prose text={text} clamp={3} />}
      {running ? (
        <RunProgress keyPrefix={`counter:comm:${d.id}`} />
      ) : (
        <>
          <div className={classes.list}>
            {gainBtn && (
              <Quantity
                icon={<img src="/comms.png" alt="" className={classes.fragIcon} />}
                label="Gain commodities"
                hint={`${gainEach} per use · room for ${roomFor} (limit ${limit})`}
                value={gain}
                onChange={setGain}
                max={gainMax}
                allowed={ladder(gainEach, gainMax)}
                maxReason={`Your commodity limit is ${limit}`}
                disabledReason={roomFor ? undefined : `Already at your commodity limit (${limit})`}
                busy={busy}
              />
            )}
            {convertBtn && (
              <Quantity
                icon={<img src="/tg.png" alt="" className={classes.fragIcon} />}
                label="Convert commodities to trade goods"
                hint={`${convertEach} per use`}
                value={shownConvert}
                onChange={setConvert}
                max={convertMax}
                allowed={ladder(convertEach, convertMax)}
                maxReason={`You will have ${after} commodit${after === 1 ? "y" : "ies"}`}
                disabledReason={after ? undefined : "No commodities to convert"}
                busy={busy}
              />
            )}
          </div>
          <QuantityTotal
            label="After"
            detail={
              <span className={classes.readout}>
                <span>
                  Commodities <b>{comms}</b> → <b>{after - shownConvert}</b>
                </span>
                <span>
                  Trade goods <b>{tg}</b> → <b>{tg + shownConvert}</b>
                </span>
              </span>
            }
            value=""
          />
          <QuantityConfirm
            label={gain || shownConvert ? [gain ? `Gain ${gain}` : "", shownConvert ? `convert ${shownConvert}` : ""].filter(Boolean).join(", ").replace(/^c/, "C") : "Done — nothing"}
            onConfirm={confirm}
            busy={busy}
          />
        </>
      )}
      <RunError />
    </div>
  );
}

const FRAG = /^purge_Frags_(CRF|IRF|HRF|URF)_(\d+)$/;
const DRAW = /^drawRelicFromFrag$/;
const TRAITS = [
  { key: "CRF", name: "Cultural", art: "crf" },
  { key: "IRF", name: "Industrial", art: "irf" },
  { key: "HRF", name: "Hazardous", art: "hrf" },
  { key: "URF", name: "Frontier", art: "urf" },
] as const;
type Trait = (typeof TRAITS)[number]["key"];

/** Purging relic fragments for a relic: fragment-count buttons per trait and "Finish Purging and Draw Relic". */
export function isFragmentStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => FRAG.test(id)) && ids.some((id) => DRAW.test(id));
}

/**
 * Purging fragments for a relic, as one panel: a counter per fragment type limited to the counts the game offers,
 * the rule (three of one type; frontier fragments count as any), and one confirm that purges then draws.
 */
export function FragmentBody({ d, data, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning(`counter:frag:${d.id}`);
  const offered: Record<Trait, number[]> = { CRF: [], IRF: [], HRF: [], URF: [] };
  for (const c of d.choices) {
    const m = baseId(c.customId).match(FRAG);
    if (m) offered[m[1] as Trait].push(Number(m[2]));
  }
  const [counts, setCounts] = useState<Record<Trait, number>>({ CRF: 0, IRF: 0, HRF: 0, URF: 0 });
  const draw = d.choices.find((c) => DRAW.test(baseId(c.customId)));
  const others = d.choices.filter((c) => !FRAG.test(baseId(c.customId)) && c !== draw);
  const need = data.me?.abilities?.includes("fabrication") ? 2 : 3;
  const typed = TRAITS.filter((t) => t.key !== "URF" && counts[t.key] > 0);
  const total = TRAITS.reduce((n, t) => n + counts[t.key], 0);
  const reason =
    total === 0
      ? `Choose ${need} fragments to purge`
      : typed.length > 1
        ? "Fragments must all be one type (frontier fragments count as any)"
        : total < need
          ? `${need - total} more to go — you need ${need} of one type`
          : undefined;
  const owned = (t: Trait) => (data.me?.fragments ?? []).filter((f) => f.toLowerCase().startsWith(t.toLowerCase())).length;

  const confirm = () => {
    const ch = d.prompt.channelId;
    const steps: PlanStep[] = TRAITS.filter((t) => counts[t.key] > 0).map((t) =>
      pressOn(ch, d.id, `Purging ${counts[t.key]} ${t.name.toLowerCase()}`, (id) => id === `purge_Frags_${t.key}_${counts[t.key]}`),
    );
    if (draw) steps.push(pressOn(ch, d.id, /explore/i.test(draw.label) ? "Exploring" : "Drawing a relic", (id) => DRAW.test(id)));
    void plan(`counter:frag:${d.id}`, steps);
  };

  return (
    <div className={classes.panel}>
      <p className={classes.hint}>
        Purge {need} fragments of one type to {draw && /explore/i.test(draw.label) ? "explore" : "draw a relic"}. Frontier fragments count as any type.
      </p>
      {running ? (
        <RunProgress keyPrefix={`counter:frag:${d.id}`} />
      ) : (
        <>
          <div className={classes.list}>
            {TRAITS.filter((t) => offered[t.key].length).map((t) => (
              <Quantity
                key={t.key}
                icon={<img src={cdnImage(`/player_area/pa_fragment_${t.art}.png`)} alt="" className={classes.fragIcon} />}
                label={`${t.name} fragments`}
                hint={`You have ${owned(t.key) || Math.max(...offered[t.key])}`}
                value={counts[t.key]}
                onChange={(n) => setCounts({ ...counts, [t.key]: n })}
                max={Math.max(...offered[t.key])}
                allowed={[0, ...offered[t.key]]}
                maxShortcut={false}
                busy={busy}
              />
            ))}
          </div>
          <QuantityTotal label="Purging" value={total} unit={`of ${need}`} />
          <QuantityConfirm
            label={draw && /explore/i.test(draw.label) ? `Purge ${total} and explore` : `Purge ${total} and draw a relic`}
            onConfirm={confirm}
            disabledReason={reason}
            busy={busy}
          />
          {others.length > 0 && (
            <ChoiceButtons choices={others} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} onHover={onHoverChoice} />
          )}
        </>
      )}
      <RunError />
    </div>
  );
}

const SC_TG = /^increaseTGonSC_(\d+)$/;

/** Manipulate Investments and the like: "+1 trade good on this strategy card" per card, then Done. */
export function isScTradeGoodStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.filter((id) => SC_TG.test(id)).length > 1 && ids.some((id) => DONE.test(id));
}

/** Trade goods onto strategy cards: a counter per card, one confirm. */
export function ScTradeGoodBody({ d }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning(`counter:sctg:${d.id}`);
  const cards = d.choices.filter((c) => SC_TG.test(baseId(c.customId)));
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)));
  const [counts, setCounts] = useState<Record<string, number>>({});
  /* Manipulate Investments (the only source of this prompt) places 5 in total; a stated "total of N" wins. */
  const limit = Number(d.text.match(/total of (\d+)/i)?.[1] ?? 5);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const spread = Object.values(counts).filter((n) => n > 0).length;
  const confirm = () => {
    const ch = d.prompt.channelId;
    const steps: PlanStep[] = cards.flatMap((c) =>
      pressTimes(ch, d.id, (i) => `${c.label}: trade good ${i + 1}`, (id) => id === baseId(c.customId), counts[c.key] ?? 0),
    );
    if (done) steps.push(pressOn(ch, d.id, "Done", (id) => DONE.test(id)));
    void plan(`counter:sctg:${d.id}`, steps);
  };
  return (
    <div className={classes.panel}>
      <p className={classes.hint}>Place {limit} trade goods in total, on at least 3 different strategy cards.</p>
      {running ? (
        <RunProgress keyPrefix={`counter:sctg:${d.id}`} />
      ) : (
        <>
          <div className={classes.grid2}>
            {cards.map((c) => (
              <Quantity
                key={c.key}
                label={c.label}
                value={counts[c.key] ?? 0}
                onChange={(n) => setCounts({ ...counts, [c.key]: n })}
                max={(counts[c.key] ?? 0) + (limit ? Math.max(0, limit - total) : 10)}
                maxShortcut={false}
                busy={busy}
                dense
              />
            ))}
          </div>
          <QuantityTotal label="Trade goods placed" value={total} unit={limit ? `of ${limit}` : undefined} />
          <QuantityConfirm
            label={`Place ${total} trade good${total === 1 ? "" : "s"}`}
            onConfirm={confirm}
            busy={busy}
            disabledReason={total < limit ? `${limit - total} left to place` : spread < 3 ? `Spread them over at least 3 cards (${spread} so far)` : undefined}
          />
        </>
      )}
      <RunError />
    </div>
  );
}

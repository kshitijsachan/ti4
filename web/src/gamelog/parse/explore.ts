/**
 * Plain one-line effects of exploration cards, from the card text the bot posts with the explore
 * ("This planet's resource value is increased by 2." → "attached to Bereg: +2 resources").
 */

const SPECIALTY: Record<string, string> = { red: "red (warfare)", blue: "blue (propulsion)", green: "green (biotic)", yellow: "yellow (cybernetic)" };

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function firstSentence(s: string) {
  const m = s.match(/^(.+?[.!])(\s|$)/s);
  return (m ? m[1] : s).replace(/[.!]$/, "").trim();
}

/** "+2 resources, +1 influence" from "resource value is increased by 2 and its influence value is increased by 1". */
function valueBoost(text: string): string | null {
  const parts: string[] = [];
  const both = text.match(/resource and influence values are each increased by (\d+)/i);
  if (both) return null;
  const res = text.match(/resource value is increased by (\d+)/i);
  const inf = text.match(/influence value is increased by (\d+)/i);
  if (res) parts.push(`+${res[1]} resource${res[1] === "1" ? "" : "s"}`);
  if (inf) parts.push(`+${inf[1]} influence`);
  return parts.length ? parts.join(", ") : null;
}

function attachEffect(text: string, planet: string): string {
  const spec = text.match(/This planet has an? (red|blue|green|yellow) technology specialty/i);
  if (spec) {
    const color = SPECIALTY[spec[1].toLowerCase()] ?? spec[1];
    const each = text.match(/each increased by (\d+)/i)?.[1] ?? "1";
    return `${planet} gains a ${color} technology specialty (or +${each} resource and +${each} influence if it already had one)`;
  }
  const boost = valueBoost(text);
  if (boost) return `${planet} gets ${boost}`;
  const attach = text.match(/ATTACH:\s*(.+)$/is)?.[1] ?? text;
  return `${planet}: ${lowerFirst(firstSentence(attach).replace(/\bthis planet\b/gi, planet))}`;
}

/** "If you have at least 1 mech on this planet, or if you remove 1 infantry from this planet, gain 1 trade good." */
function conditional(text: string): string | null {
  const m = text.match(/^If you have at least 1 mech on this planet, or if you remove 1 infantry from this planet, (.+?)\.?$/is);
  return m ? `${firstSentence(m[1])} (needs a mech there, or 1 infantry removed)` : null;
}

export function isAttachment(text: string) {
  return /^ATTACH:|\bATTACH:|This planet has an? \w+ technology specialty|^This planet's (resource|influence) value is increased/i.test(text);
}

/**
 * The effect of an exploration card in a few words. `planet` is the explored planet, or undefined for a
 * frontier token.
 */
export function exploreEffect(card: string, text: string, planet?: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const frag = card.match(/^(Cultural|Hazardous|Industrial|Unknown) Relic Fragment$/i);
  if (frag) return `gained ${/^[aeiou]/i.test(frag[1]) ? "an" : "a"} ${frag[1].toLowerCase()} relic fragment`;
  if (!clean) return "";
  if (planet && isAttachment(clean)) return `attached — ${attachEffect(clean, planet)}`;
  const cond = conditional(clean);
  if (cond) return lowerFirst(planet ? cond.replace(/\bthis planet\b/gi, planet) : cond);
  // "Place this card faceup in your play area. ACTION: …" — the card stays, its later use is what matters.
  const kept = clean.match(/^Place this card face ?up in your play area\.\s*(.+)$/i);
  if (kept) return `kept in play — ${lowerFirst(firstSentence(kept[1].replace(/^ACTION:\s*(You may )?/i, "action: ")))}`;
  let line = firstSentence(clean.replace(/^ACTION:\s*/i, "")).replace(/, or you may /g, ", or ");
  if (planet) line = line.replace(/\bthis planet\b/gi, planet);
  line = line.replace(/\bthis system\b/gi, "the system").replace(/^You may /, "may ");
  return lowerFirst(line);
}

import type { PlayerData } from "@/entities/data/types";
import { CardFace } from "../CardFace";
import { buildHand } from "../model";
import { useCardData } from "../cardData";

const me = {
  faction: "keleresa",
  color: "purple",
  userName: "Tess",
  relics: ["mawofworlds", "shard", "codex"],
  exhaustedRelics: ["codex"],
  fragments: ["crf1", "crf2", "hrf1", "urf1"],
  secretsScored: { bam: 416 },
  promissoryNotesInPlayArea: ["plaid_sftt"],
} as unknown as PlayerData;
const players = [me, { faction: "l1z1x", color: "plaid", userName: "Bot Gamma" } as unknown as PlayerData];

/** Offline gallery of card faces the live games do not currently hold (relics, fragments, scored, in play). */
export function Gallery() {
  useCardData();
  const groups = buildHand(
    { actionCards: ["meltdown", "strategize1", "sabo1"], secretObjectives: ["btv"], promissoryNotes: ["plaid_ps"] },
    me,
    players,
  );
  const cards = groups.flatMap((g) => g.cards);
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {cards.map((card, i) => (
          <CardFace key={card.key} card={card} size="mini" number={100 + i} timing={i === 0 ? "now" : "later"} actionable />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        {cards.filter((c) => ["relic", "fragment", "so"].includes(c.kind) || c.inPlayArea).slice(0, 5).map((card) => (
          <CardFace key={card.key} card={card} size="large" />
        ))}
      </div>
    </div>
  );
}

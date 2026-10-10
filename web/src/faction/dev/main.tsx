import "@mantine/core/styles.css";
import "@/styles/fonts.css";
import "@/styles/gradients.css";
import "@/styles/theme.css";
import "@/styles/overlays.css";
import "@/styles/zIndexVariables.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { FactionSheet } from "../FactionSheet";
import { FactionSheetButton } from "../FactionSheetButton";
import { UnitTooltip } from "../UnitTooltip";
import type { FactionPlayer } from "../types";
import { Gallery } from "./Gallery";

const params = new URLSearchParams(location.search);
const faction = params.get("faction") ?? "arborec";
const theme = params.get("theme") ?? "midnightgraytheme";
const compact = params.get("compact") === "1";
const width = Number(params.get("width") ?? 0) || undefined;
const game = params.get("game");
const playerFaction = params.get("player");
const color = params.get("color") ?? undefined;
document.body.classList.add(`theme-${theme}`);
document.body.style.margin = "0";
document.body.style.background = "var(--main-bg, #0a0a0a)";

/** Live player state from the bot's web-data, when ?game=&player=<faction> is given. */
function useLivePlayer(): FactionPlayer | undefined {
  const [player, setPlayer] = useState<FactionPlayer>();
  useEffect(() => {
    if (!game || !playerFaction) return;
    void fetch(`/bot/api/public/game/${game}/web-data`)
      .then((r) => r.json() as Promise<{ playerData: FactionPlayer[] }>)
      .then((d) => setPlayer(d.playerData.find((p) => p.faction === playerFaction)));
  }, []);
  return player;
}

function Single() {
  const player = useLivePlayer();
  const shown = player?.faction ?? faction;
  return (
    <div style={{ padding: 24, maxWidth: width ?? 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, fontFamily: "var(--font-text)", fontSize: 12, color: "#888" }}>
        <FactionSheetButton faction={shown} player={player} />
        <UnitTooltip unitId="fs" faction={shown} owned={player?.unitsOwned} color={player?.color ?? color}>
          <span style={{ textDecoration: "underline dotted" }}>hover: flagship tooltip</span>
        </UnitTooltip>
        <UnitTooltip unitId="mf" faction={shown} owned={player?.unitsOwned} color={player?.color ?? color}>
          <span style={{ textDecoration: "underline dotted" }}>hover: mech tooltip</span>
        </UnitTooltip>
        {game && <span>live: {game} / {playerFaction} {player ? "" : "(loading…)"}</span>}
      </div>
      <FactionSheet faction={shown} player={player} playerColor={player?.color ?? color} compact={compact} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">{params.get("gallery") ? <Gallery all={params.get("all") === "1"} /> : <Single />}</MantineProvider>
  </StrictMode>,
);

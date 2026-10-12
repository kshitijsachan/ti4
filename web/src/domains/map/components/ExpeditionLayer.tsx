import { cdnImage } from "@/entities/data/cdnImage";
import { ExpeditionTokens } from "./ExpeditionTokens";
import { useGameData } from "@/state/useGameContext";
import { useSettingsStore } from "@/state/appStore";

type Props = {
  contentSize: {
    width: number;
    height: number;
  };
};

export function ExpeditionLayer({ contentSize }: Props) {
  const gameData = useGameData();
  const onMap = useSettingsStore((s) => s.settings.showMapPlayerStats);
  const hasIncompleteExpeditions = Object.values(
    gameData?.expeditions ?? {},
  ).some((expedition) => expedition.completedBy == null);

  if (!hasIncompleteExpeditions || !onMap) return null;

  const left = 100;
  const top = contentSize.height - 400;

  return (
    <>
      <img
        src={cdnImage(`/general/Expeditions.png`)}
        alt="Expeditions"
        style={{ position: "absolute", left, top, zIndex: 50 }}
      />
      <ExpeditionTokens expeditionsImageLeft={left} expeditionsImageTop={top} />
    </>
  );
}

/** The expeditions wheel and who has completed what, laid out on its own (off the map). */
export function ExpeditionsBoard() {
  const gameData = useGameData();
  const expeditions = Object.values(gameData?.expeditions ?? {});
  if (!expeditions.length) return null;
  return (
    <div style={{ position: "relative", width: 300, height: 300 }}>
      <img
        src={cdnImage(`/general/Expeditions.png`)}
        alt="Expeditions"
        style={{ position: "absolute", left: 0, top: 0 }}
      />
      <ExpeditionTokens expeditionsImageLeft={0} expeditionsImageTop={0} />
    </div>
  );
}

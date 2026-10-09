import "@mantine/core/styles.css";
import "../../styles/fonts.css";
import "../../styles/gradients.css";
import "../../styles/theme.css";
import "../../styles/overlays.css";
import "../../styles/zIndexVariables.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { PlayProvider, usePlay } from "@/discord";
import { GameLog } from "@/gamelog";
import { setToken } from "@/play/session";
import { UndoButton, useUndoPoints } from "../index";
import classes from "./harness.module.css";

const params = new URLSearchParams(window.location.search);
const token = params.get("t") ?? "";
const game = params.get("g") ?? "pbd8";
if (token) setToken(token, true);

type WebData = { playerData: { faction: string; scs: number[]; tg: number; passed: boolean }[]; gameState: { phase: string; activePlayer?: string } };

/** Live check of the restored state: SC picks and trade goods from the bot's web-data. */
function TableState() {
  const { data } = useUndoPoints(game);
  const [web, setWeb] = useState<WebData | null>(null);
  const latest = data?.latestIndex;
  useEffect(() => {
    void fetch(`/bot/api/public/game/${game}/web-data`)
      .then((r) => r.json() as Promise<WebData>)
      .then(setWeb);
  }, [latest]);
  return (
    <div className={classes.table} data-testid="state">
      <h3>web-data (save {latest ?? "…"})</h3>
      <table>
        <tbody>
          {web?.playerData.map((p) => (
            <tr key={p.faction} data-faction={p.faction}>
              <td>{p.faction}</td>
              <td>SC {p.scs.join(",") || "–"}</td>
              <td>{p.tg} TG</td>
              <td>{p.passed ? "passed" : ""}</td>
            </tr>
          ))}
          <tr>
            <td>phase</td>
            <td>{web?.gameState.phase}</td>
          </tr>
        </tbody>
      </table>
      <h3>undo saves (newest first)</h3>
      <table>
        <tbody>
          {data?.points.slice(0, 14).map((p) => (
            <tr key={p.index} className={p.current ? classes.current : undefined}>
              <td>{p.index}</td>
              <td>{new Date(p.savedAt).toLocaleTimeString([], { hour12: false })}</td>
              <td>{p.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>roll-backs</h3>
      <table>
        <tbody>
          {data?.rewinds.slice(-6).map((r) => (
            <tr key={r.at}>
              <td>{new Date(r.at).toLocaleTimeString([], { hour12: false })}</td>
              <td>{r.kind}</td>
              <td>
                {r.fromIndex} → {r.toIndex}
              </td>
              <td>{r.byName || "bot button / command"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Shell() {
  const me = usePlay((s) => s.me);
  const [drawer, setDrawer] = useState(true);
  return (
    <div className={classes.shell}>
      <header className={classes.top}>
        <span className={classes.brand}>
          TI4 · {game} · {me?.global_name ?? me?.username ?? "…"}
        </span>
        <GameLog gameName={game} variant="ticker" max={2} className={classes.ticker} />
        <UndoButton gameName={game} onOpenHistory={() => setDrawer(true)} />
        <button type="button" onClick={() => setDrawer((d) => !d)}>
          log
        </button>
      </header>
      <TableState />
      {drawer && (
        <aside className={classes.drawer}>
          <GameLog gameName={game} variant="full" defaultView="timeline" />
        </aside>
      )}
    </div>
  );
}

function App() {
  if (!token) return <div className={classes.missing}>Add ?t=&lt;seat token&gt;&amp;g=&lt;game&gt; to the URL.</div>;
  return (
    <PlayProvider token={token}>
      <Shell />
    </PlayProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);

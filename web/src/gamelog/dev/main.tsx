import "@mantine/core/styles.css";
import "../../styles/fonts.css";
import "../../styles/gradients.css";
import "../../styles/theme.css";
import "../../styles/overlays.css";
import "../../styles/zIndexVariables.css";

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { PlayProvider, usePlay } from "@/discord";
import { GameLog, useGameEvents, useLogFocus } from "../index";
import classes from "./harness.module.css";

const params = new URLSearchParams(window.location.search);
const token = params.get("t") ?? "";
const game = params.get("g") ?? "pbd1";
const view = (params.get("view") ?? "phases") as "phases" | "players" | "timeline";

function Stats() {
  const { stats, events, loading } = useGameEvents(game);
  const evMsgs = Object.values(stats.events).reduce((a, n) => a + (n ?? 0), 0);
  const dropped = Object.values(stats.noise).reduce((a, n) => a + n, 0);
  return (
    <div className={classes.stats}>
      <div>
        {stats.total} bot+player messages → <b>{events.length}</b> events · {evMsgs} event msgs · {dropped} dropped · {stats.other} unrecognised
        {loading ? " · loading…" : ""}
      </div>
      <div className={classes.kinds}>
        {Object.entries(stats.events).map(([k, n]) => (
          <span key={k}>
            {k} {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function FocusProbe() {
  const focus = useLogFocus((s) => s.focus);
  return <div className={classes.focus}>{focus ? `map focus → system ${focus.position} (event ${focus.eventId})` : "click an event with a system to focus the map"}</div>;
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
        <GameLog gameName={game} variant="ticker" className={classes.ticker} onOpen={() => setDrawer((d) => !d)} />
      </header>
      <main className={classes.table}>
        <FocusProbe />
        <Stats />
      </main>
      {drawer && (
        <aside className={classes.drawer}>
          <GameLog gameName={game} variant="full" defaultView={view} />
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

import "@mantine/core/styles.css";
import "../../styles/fonts.css";
import "../../styles/gradients.css";
import "../../styles/theme.css";
import "../../styles/overlays.css";
import "../../styles/zIndexVariables.css";

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider, Modal, Tooltip } from "@mantine/core";
import { ActionLog, ChannelList, ChannelView, HandPanel, ModalHost, PlayConnection, PlayProvider, Toasts, usePlay } from "../index";
import { bulkFrame, fixtureFrames } from "./fixtures";
import { REAL_CHANNEL_ID, realFixtureFrames } from "./realFixtures";
import classes from "./harness.module.css";

const theme = createTheme({
  fontFamily: "var(--font-text)",
  fontFamilyMonospace: "var(--font-data)",
  headings: { fontFamily: "var(--font-display)", fontWeight: "600" },
  components: {
    Modal: Modal.extend({
      defaultProps: { overlayProps: { backgroundOpacity: 0.6, blur: 3 } },
      classNames: { content: "overlay-modal-content", header: "overlay-modal-header", title: "overlay-modal-title" },
    }),
    Tooltip: Tooltip.extend({ classNames: { tooltip: "overlay-tooltip" } }),
  },
});

const params = new URLSearchParams(window.location.search);
const token = params.get("t") ?? "";
const wsUrl = params.get("ws") ?? undefined;
const useFixtures = params.has("fixtures");

/** An offline connection pre-loaded with synthetic frames, so every renderer state can be eyeballed. */
function fixtureConnection(): PlayConnection {
  const conn = new PlayConnection({ token: "fixtures" });
  for (const f of fixtureFrames) conn.actions.apply(f);
  conn.actions.setStatus("open");
  conn.actions.setActiveChannel("100");
  if (params.get("fixtures") === "real") {
    const real = realFixtureFrames();
    conn.actions.apply({ t: "channel_upsert", channel: { id: REAL_CHANNEL_ID, type: 0, name: "captured-fixtures", position: -1 } });
    conn.actions.apply({ t: "history", channel_id: REAL_CHANNEL_ID, messages: real.messages, has_more: false });
    conn.actions.setActiveChannel(REAL_CHANNEL_ID);
    if (params.has("modal")) for (const m of real.modals) conn.actions.apply(m);
  }
  if (params.has("bulk")) conn.actions.apply(bulkFrame(Number(params.get("bulk")) || 2000));
  for (const f of fixtureFrames) {
    if (f.t !== "history") continue;
    const m = f.messages.find((x) => x.components?.some((r) => r.components?.some((c) => c.custom_id === "pending_demo")));
    if (m) conn.actions.addPending("demo", `${m.id}:pending_demo`);
  }
  if (params.has("modal") && params.get("fixtures") !== "real") {
    conn.actions.apply({
      t: "modal",
      interaction_id: "m1",
      modal: {
        custom_id: "fx_modal",
        title: "Transaction with Bob",
        components: [
          { type: 10, content: "Offer **trade goods** and promissory notes." },
          { type: 18, label: "Trade goods", description: "How many to send", component: { type: 4, custom_id: "tg", style: 1, placeholder: "0", required: true } },
          {
            type: 18,
            label: "Promissory note",
            component: { type: 3, custom_id: "pn", placeholder: "Pick a note", options: [{ label: "Trade Agreement", value: "ta" }, { label: "Ceasefire", value: "cf" }] },
          },
          { type: 1, components: [{ type: 4, custom_id: "msg", style: 2, label: "Message", required: false, max_length: 400 }] },
        ],
      },
    });
  }
  return conn;
}
const fixtures = useFixtures ? fixtureConnection() : undefined;

/** Game id from a channel name like `pbd1-actions`; falls back to the first game channel we can see. */
function useGameName(): string | null {
  return usePlay((s) => {
    const active = s.activeChannelId ? s.channels[s.activeChannelId] : undefined;
    const fromActive = active?.name.match(/^([a-z]+\d+)-/)?.[1];
    if (fromActive) return fromActive;
    for (const id in s.channels) {
      const m = s.channels[id].name.match(/^([a-z]+\d+)-actions$/);
      if (m) return m[1];
    }
    return null;
  });
}

function Shell() {
  const active = usePlay((s) => s.activeChannelId);
  const me = usePlay((s) => s.me);
  const game = useGameName();
  const [side, setSide] = useState<"log" | "hand">("log");
  return (
    <div className={classes.shell}>
      <aside className={classes.sidebar}>
        <div className={classes.brand}>
          TI4 · {me?.global_name ?? "…"}
          {game && <span className={classes.game}>{game}</span>}
        </div>
        <ChannelList />
      </aside>
      <main className={classes.main}>
        <ChannelView channelId={active} />
      </main>
      {game && (
        <aside className={classes.side}>
          <div className={classes.tabs} role="tablist">
            <button type="button" role="tab" aria-selected={side === "log"} onClick={() => setSide("log")}>
              Action log
            </button>
            <button type="button" role="tab" aria-selected={side === "hand"} onClick={() => setSide("hand")}>
              Hand
            </button>
          </div>
          <div className={classes.sideBody}>
            {side === "log" ? <ActionLog gameName={game} composer={false} /> : <HandPanel gameName={game} />}
          </div>
        </aside>
      )}
      <ModalHost />
      <Toasts />
    </div>
  );
}

function App() {
  if (!token && !fixtures) return <div className={classes.missing}>Add ?t=&lt;seat token&gt; (or ?fixtures=1) to the URL.</div>;
  return (
    <PlayProvider token={token} url={wsUrl} connection={fixtures}>
      <Shell />
    </PlayProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <App />
    </MantineProvider>
  </StrictMode>,
);

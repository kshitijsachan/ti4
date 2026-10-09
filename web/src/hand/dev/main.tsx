import "@mantine/core/styles.css";
import "@/styles/fonts.css";
import "@/styles/gradients.css";
import "@/styles/theme.css";
import "@/styles/overlays.css";
import "@/styles/zIndexVariables.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChannelView, ModalHost, PlayProvider, Toasts, usePlay } from "@/discord";
import { isHandThread } from "@/discord/channels/GamePanels";
import { usePlayerDataSocket } from "@/api/usePlayerData";
import { setToken } from "@/play/session";
import { HandTray } from "../HandTray";
import { Gallery } from "./Gallery";

const params = new URLSearchParams(location.search);
const game = params.get("game") ?? "pbd9";
const token = params.get("t") ?? "";
const theme = params.get("theme") ?? "midnightgraytheme";
const debug = params.get("debug") === "1";
if (token) setToken(token, true);
document.body.classList.add(`theme-${theme}`);
document.body.style.margin = "0";
document.body.style.background = "var(--main-bg, #0a0a0a)";

const queryClient = new QueryClient();

function Table() {
  const { data } = usePlayerDataSocket(game);
  const me = usePlay((s) => s.me);
  const threadId = usePlay((s) => {
    for (const id in s.channels) if (isHandThread(s.channels[id].name, game)) return id;
    return undefined;
  });
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#555",
            fontFamily: "var(--font-text)",
            fontSize: 13,
            background:
              "radial-gradient(60% 60% at 50% 45%, rgba(40,60,90,0.25), transparent), #07090c",
          }}
        >
          {game} · {me?.username ?? "connecting…"} · round {data?.gameRound ?? "?"} ·{" "}
          {data?.gameState?.phase ?? ""} · active {data?.gameState?.activePlayer ?? "-"}
        </div>
        {debug && threadId && (
          <div style={{ width: 460, borderLeft: "1px solid #333" }}>
            <ChannelView channelId={threadId} variant="hand" composer={false} />
          </div>
        )}
      </div>
      <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
        <HandTray gameName={game} defaultOpen={params.get("open") === "1"} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={queryClient}>
        {params.get("gallery") === "1" ? (
          <Gallery />
        ) : token ? (
          <PlayProvider token={token}>
            <Table />
            <ModalHost />
            <Toasts />
          </PlayProvider>
        ) : (
          <div style={{ padding: 20, color: "#aaa" }}>Pass ?game=&amp;t=&lt;seat token&gt;</div>
        )}
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);

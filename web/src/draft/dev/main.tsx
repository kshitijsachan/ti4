import "@mantine/core/styles.css";
import "@/styles/fonts.css";
import "@/styles/gradients.css";
import "@/styles/theme.css";
import "@/styles/overlays.css";
import "@/styles/zIndexVariables.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { DraftView } from "../DraftView";
import { ShimSocket } from "./shimSocket";

const params = new URLSearchParams(location.search);
const game = params.get("game") ?? "pbd1";
const token = params.get("t") ?? "";
const theme = params.get("theme") ?? "midnightgraytheme";
document.body.classList.add(`theme-${theme}`);
document.body.style.margin = "0";
document.body.style.background = "var(--main-bg, #0a0a0a)";

function Harness() {
  const [socket, setSocket] = useState<ShimSocket | null>(null);
  const [me, setMe] = useState<string>(params.get("me") ?? "");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!token) return;
    const socket = new ShimSocket(token);
    setSocket(socket);
    socket.hello.then((h) => setMe(h.me.id)).catch(() => {});
    socket.onFrame = (f) => {
      if (f.t === "message_create" || f.t === "message_update")
        setRefresh((n) => n + 1);
    };
    return () => socket.close();
  }, []);

  if (!me)
    return (
      <div style={{ padding: 20, color: "#aaa" }}>
        Connecting… (pass ?game=&t=&lt;token&gt;)
      </div>
    );
  return (
    <DraftView
      gameName={game}
      myUserId={me}
      refreshSignal={refresh}
      onPick={(customId, channelId, messageId) =>
        socket
          ? socket.click(channelId, messageId, customId)
          : Promise.resolve({ error: "no socket" })
      }
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark">
      <Harness />
    </MantineProvider>
  </StrictMode>,
);

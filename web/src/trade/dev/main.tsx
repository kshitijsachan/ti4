import "@mantine/core/styles.css";
import "@/styles/fonts.css";
import "@/styles/gradients.css";
import "@/styles/theme.css";
import "@/styles/overlays.css";
import "@/styles/zIndexVariables.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { TradePanel } from "../TradePanel";

const params = new URLSearchParams(location.search);
const game = params.get("game") ?? "pbd1";
const token = params.get("t") ?? "";
const theme = params.get("theme") ?? "midnightgraytheme";
const width = params.get("w");
document.body.classList.add(`theme-${theme}`);
document.body.style.margin = "0";
document.body.style.background = "var(--main-bg, #0a0a0a)";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark">
      <div style={{ padding: 16, maxWidth: width ? Number(width) : 980 }}>
        <TradePanel gameName={game} token={token} initialCounterparty={params.get("to") ?? undefined} />
      </div>
    </MantineProvider>
  </StrictMode>,
);

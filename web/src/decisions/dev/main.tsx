import "@mantine/core/styles.css";
import "../../styles/fonts.css";
import "../../styles/gradients.css";
import "../../styles/theme.css";
import "../../styles/overlays.css";
import "../../styles/zIndexVariables.css";

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider, Modal, Tooltip } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ModalHost,
  PlayConnection,
  PlayProvider,
  Toasts,
  usePlay,
  type Channel,
  type Message,
  type Role,
  type User,
} from "@/discord";
import { usePlayerDataSocket } from "@/api/usePlayerData";
import type { PlayerDataResponse } from "@/entities/data/types";
import { DecisionHost, useDecisionFocus, useDecisionRequests } from "../index";
import { DecisionPopup } from "../ui/DecisionHost";
import { classify } from "../model/classify";
import { findGame } from "../detect/games";
import { usePendingPrompts } from "../detect/pending";
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
const gameParam = params.get("game") ?? "";
const debug = params.has("debug");

type Fixture = {
  id: string;
  game: string;
  meId: string;
  channelId: string;
  messageId: string;
  channels: Channel[];
  users: (User & { roles?: string[] })[];
  roles: Role[];
  messages: Record<string, Message[]>;
  web?: PlayerDataResponse;
  hand?: string[];
};

const fixtureFiles = import.meta.glob<Fixture>("./fixtures/*.json", { eager: true, import: "default" });
const fixtures = Object.values(fixtureFiles).sort((a, b) => a.id.localeCompare(b.id));

/** Map focus and trade requests, as the board would read them. */
function Signals() {
  const focus = useDecisionFocus();
  const trade = useDecisionRequests((s) => s.openTrade);
  return (
    <div className={classes.signals}>
      <span>focus: {focus.position ?? "—"}{focus.source ? ` (${focus.source})` : ""}</span>
      {trade && <span>open trade: {trade.playerName ?? trade.faction} #{trade.key}</span>}
    </div>
  );
}

function PendingDebug({ gameName }: { gameName: string }) {
  const me = usePlay((s) => s.me);
  const prompts = usePendingPrompts(gameName, { myTurn: true });
  return (
    <ol className={classes.debug}>
      <li>me: {me?.global_name ?? me?.username}</li>
      {prompts.map((p) => (
        <li key={p.message.id}>
          {p.where} · {p.reason} · {p.message.content.slice(0, 80)}
        </li>
      ))}
    </ol>
  );
}

function LiveGame({ gameName }: { gameName: string }) {
  usePlayerDataSocket(gameName);
  const channels = usePlay((s) => s.channels);
  const status = usePlay((s) => s.status);
  const me = usePlay((s) => s.me);
  const known = !!findGame(channels, gameName);
  return (
    <div className={classes.page}>
      <div className={classes.table}>
        <span className={classes.tableName}>{gameName}</span>
        <span className={classes.tableNote}>
          {status} · {me?.global_name ?? "…"} {known ? "" : "· game channels not visible"}
        </span>
      </div>
      <Signals />
      {debug && <PendingDebug gameName={gameName} />}
      <DecisionHost gameName={gameName} />
      <ModalHost />
      <Toasts />
    </div>
  );
}

function fixtureConnection(f: Fixture) {
  const conn = new PlayConnection({ token: `fixture-${f.id}` });
  const me = f.users.find((u) => u.id === f.meId) ?? { id: f.meId, username: "me" };
  conn.actions.apply({
    t: "hello",
    me,
    bot_id: "0",
    guild_id: "0",
    users: f.users,
    roles: f.roles,
    channels: f.channels,
    commands: [],
    bot_online: true,
  });
  for (const [channelId, messages] of Object.entries(f.messages)) {
    conn.actions.apply({ t: "history", channel_id: channelId, messages, has_more: false });
  }
  conn.actions.setStatus("open");
  return conn;
}

function FixtureView({ f, client }: { f: Fixture; client: QueryClient }) {
  const decision = useMemo(() => {
    const message = f.messages[f.channelId].find((m) => m.id === f.messageId)!;
    const channels = Object.fromEntries(f.channels.map((c) => [c.id, c]));
    const users = Object.fromEntries(f.users.map((u) => [u.id, u]));
    const messages = Object.fromEntries(
      Object.entries(f.messages).map(([id, list]) => [
        id,
        { ids: list.map((m) => m.id), byId: Object.fromEntries(list.map((m) => [m.id, m])), hasMore: false, loading: false, loaded: true },
      ]),
    );
    const game = findGame(channels, f.game)!;
    const me = f.web?.playerData.find((p) => p.discordId === f.meId);
    const where = channels[f.channelId]?.name ?? "";
    return classify(
      { message, channelId: f.channelId, where, reason: "mention" },
      { state: { users, channels, messages }, game, web: f.web, me },
    );
  }, [f]);
  if (f.web) client.setQueryData(["playerData", f.game], f.web);
  const me = f.web?.playerData.find((p) => p.discordId === f.meId);
  return (
    <DecisionPopup
      decisions={[decision]}
      data={{ gameName: f.game, web: f.web, me, players: f.web?.playerData ?? [], hand: f.hand }}
    />
  );
}

function Fixtures({ client }: { client: QueryClient }) {
  const id = params.get("fixture") ?? fixtures[0]?.id;
  const f = fixtures.find((x) => x.id === id);
  const conn = useMemo(() => (f ? fixtureConnection(f) : undefined), [f]);
  return (
    <div className={classes.page}>
      <nav className={classes.fixtureNav}>
        {fixtures.map((x) => (
          <a key={x.id} href={`?fixtures=1&fixture=${x.id}`} aria-current={x.id === id || undefined}>
            {x.id}
          </a>
        ))}
      </nav>
      {f && conn ? (
        <PlayProvider token="fixtures" connection={conn} key={f.id}>
          <Signals />
          <FixtureView f={f} client={client} />
          <ModalHost />
        </PlayProvider>
      ) : (
        <p className={classes.tableNote}>No fixture “{id}”.</p>
      )}
    </div>
  );
}

const queryClient = new QueryClient();

function App() {
  if (params.has("fixtures")) return <Fixtures client={queryClient} />;
  if (!token || !gameParam) {
    return <div className={classes.page}>Add ?t=&lt;seat token&gt;&amp;game=&lt;game&gt; (or ?fixtures=1) to the URL.</div>;
  }
  return (
    <PlayProvider token={token}>
      <LiveGame gameName={gameParam} />
    </PlayProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);

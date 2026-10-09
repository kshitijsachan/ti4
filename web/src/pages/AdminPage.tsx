import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import cx from "clsx";
import { SiteFrame } from "@/play/SiteFrame";
import { inviteLink, seatTabLink } from "@/play/session";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import classes from "./AdminPage.module.css";

type Seat = {
  name: string;
  user_id: string;
  token: string;
  /** Played by the server's autopilot (solo testing). */
  autopilot?: boolean;
};

/** Names for solo-test opponents, in order. */
const BOT_NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"].map((n) => `Bot ${n}`);

const KEY_STORAGE = "ti4online.adminKey";

function readKey() {
  const fromUrl = new URLSearchParams(window.location.search).get("key");
  try {
    if (fromUrl) localStorage.setItem(KEY_STORAGE, fromUrl);
    return fromUrl ?? localStorage.getItem(KEY_STORAGE);
  } catch {
    return fromUrl;
  }
}

async function adminFetch<T>(
  key: string,
  init?: RequestInit,
  path = "players",
): Promise<T> {
  const res = await fetch(
    `/app/admin/${path}?key=${encodeURIComponent(key)}`,
    init,
  );
  if (res.status === 403) throw new Error("That admin key was not accepted.");
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return res.json() as Promise<T>;
}

function splitNames(text: string) {
  return text
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function SeatRow({
  seat,
  onAutopilot,
  busy,
}: {
  seat: Seat;
  onAutopilot: (enabled: boolean) => void;
  busy: boolean;
}) {
  const link = inviteLink(seat.token);
  return (
    <li className={classes.row}>
      <span className={classes.name}>
        {seat.name}
        {seat.autopilot && <span className={classes.badge}>Autopilot</span>}
      </span>
      <code className={classes.link}>{link}</code>
      <label
        className={classes.toggle}
        title="Let the server play this seat with simple default moves"
      >
        <input
          type="checkbox"
          checked={!!seat.autopilot}
          disabled={busy}
          onChange={(e) => onAutopilot(e.currentTarget.checked)}
        />
        Autopilot
      </label>
      <a
        className={classes.copy}
        href={seatTabLink(seat.token)}
        target="_blank"
        rel="noopener"
        title={`Play as ${seat.name} in a new tab (this tab keeps its own seat)`}
      >
        <IconExternalLink size={14} />
        Open as
      </a>
      <CopyButton value={link} timeout={1600}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copied" : "Copy link"} position="left">
            <UnstyledButton
              className={cx(classes.copy, copied && classes.copied)}
              onClick={copy}
              aria-label={`Copy ${seat.name}'s link`}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "Copied" : "Copy"}
            </UnstyledButton>
          </Tooltip>
        )}
      </CopyButton>
    </li>
  );
}

/** Host tools: make a seat per friend and hand out their private links. */
export default function AdminPage() {
  useDocumentTitle("Host · TI4 Online");
  const [key] = useState(readKey);
  const [names, setNames] = useState("");
  const [autopilot, setAutopilot] = useState(false);
  const [bots, setBots] = useState(2);
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-players", key] });

  const players = useQuery({
    queryKey: ["admin-players", key],
    queryFn: () => adminFetch<Seat[]>(key!),
    enabled: !!key,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (args: { names: string[]; autopilot: boolean }) =>
      adminFetch<Seat[]>(key!, postJson(args)),
    onSuccess: (_data, args) => {
      if (!args.names.every((n) => n.startsWith("Bot "))) setNames("");
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: (args: { user_id: string; enabled: boolean }) =>
      adminFetch<unknown>(key!, postJson(args), "autopilot"),
    onSuccess: refresh,
  });

  const taken = new Set(players.data?.map((p) => p.name) ?? []);
  const freeBotNames = BOT_NAMES.filter((n) => !taken.has(n)).slice(0, bots);

  const pending = splitNames(names);

  if (!key) {
    return (
      <SiteFrame>
        <h1 className={classes.heading}>Host</h1>
        <p className={classes.note}>
          Open this page with the admin link the server printed at startup (
          <code>/admin?key=…</code>).
        </p>
      </SiteFrame>
    );
  }

  return (
    <SiteFrame>
      <h1 className={classes.heading}>Host</h1>
      <p className={classes.note}>
        Add a seat for each friend, then send them their link. Anyone holding a
        link plays as that seat, so send each one privately.
      </p>

      <form
        className={classes.panel}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending.length) create.mutate({ names: pending, autopilot });
        }}
      >
        <label className={classes.label} htmlFor="player-names">
          New players
        </label>
        <div className={classes.addRow}>
          <input
            id="player-names"
            className={classes.input}
            placeholder="Names, separated by commas"
            value={names}
            onChange={(e) => setNames(e.currentTarget.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className={classes.primary}
            disabled={!pending.length || create.isPending}
          >
            {pending.length > 1
              ? `Add ${pending.length} players`
              : "Add player"}
          </button>
        </div>
        <label className={classes.check}>
          <input
            type="checkbox"
            checked={autopilot}
            onChange={(e) => setAutopilot(e.currentTarget.checked)}
          />
          Autopilot: the server plays these seats with simple default moves
        </label>
        {create.error && (
          <p className={classes.error}>{create.error.message}</p>
        )}
      </form>

      <section className={classes.panel}>
        <div className={classes.label}>Solo test</div>
        <p className={classes.hint}>
          Try the game alone: add autopilot opponents, then start a game from
          your own seat and invite them. They draft, pick strategy cards, pass,
          decline reactions and abstain so the game keeps moving.
        </p>
        <div className={classes.addRow}>
          <select
            className={classes.select}
            value={bots}
            onChange={(e) => setBots(Number(e.currentTarget.value))}
            aria-label="Number of autopilot opponents"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} opponents
              </option>
            ))}
          </select>
          <button
            type="button"
            className={classes.primary}
            disabled={create.isPending || freeBotNames.length === 0}
            onClick={() =>
              create.mutate({ names: freeBotNames, autopilot: true })
            }
          >
            Solo test
          </button>
        </div>
      </section>

      <section className={classes.panel}>
        <div className={classes.label}>
          Players
          {players.data && (
            <span className={classes.count}>{players.data.length}</span>
          )}
        </div>
        {players.isLoading && <p className={classes.note}>Loading…</p>}
        {players.error && (
          <p className={classes.error}>{players.error.message}</p>
        )}
        {toggle.error && (
          <p className={classes.error}>{toggle.error.message}</p>
        )}
        {players.data?.length === 0 && (
          <p className={classes.note}>No players yet. Add your first above.</p>
        )}
        {!!players.data?.length && (
          <ul className={classes.list}>
            {players.data.map((seat) => (
              <SeatRow
                key={seat.token}
                seat={seat}
                busy={toggle.isPending}
                onAutopilot={(enabled) =>
                  toggle.mutate({ user_id: seat.user_id, enabled })
                }
              />
            ))}
          </ul>
        )}
      </section>
    </SiteFrame>
  );
}

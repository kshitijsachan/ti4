import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import cx from "clsx";
import { SiteFrame } from "@/play/SiteFrame";
import { inviteLink } from "@/play/session";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import classes from "./AdminPage.module.css";

type Seat = {
  name: string;
  user_id: string;
  token: string;
};

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

async function adminFetch<T>(key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(
    `/app/admin/players?key=${encodeURIComponent(key)}`,
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

function SeatRow({ seat }: { seat: Seat }) {
  const link = inviteLink(seat.token);
  return (
    <li className={classes.row}>
      <span className={classes.name}>{seat.name}</span>
      <code className={classes.link}>{link}</code>
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
  const queryClient = useQueryClient();

  const players = useQuery({
    queryKey: ["admin-players", key],
    queryFn: () => adminFetch<Seat[]>(key!),
    enabled: !!key,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (list: string[]) =>
      adminFetch<Seat[]>(key!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: list }),
      }),
    onSuccess: () => {
      setNames("");
      void queryClient.invalidateQueries({ queryKey: ["admin-players", key] });
    },
  });

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
          if (pending.length) create.mutate(pending);
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
        {create.error && (
          <p className={classes.error}>{create.error.message}</p>
        )}
      </form>

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
        {players.data?.length === 0 && (
          <p className={classes.note}>No players yet. Add your first above.</p>
        )}
        {!!players.data?.length && (
          <ul className={classes.list}>
            {players.data.map((seat) => (
              <SeatRow key={seat.token} seat={seat} />
            ))}
          </ul>
        )}
      </section>
    </SiteFrame>
  );
}

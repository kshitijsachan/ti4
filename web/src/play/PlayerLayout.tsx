import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ModalHost, PlayProvider, Toasts } from "@/discord";
import { adoptTokenFromUrl } from "@/play/session";
import { SiteFrame } from "@/play/SiteFrame";
import classes from "./PlayerLayout.module.css";

type Me = {
  user: { id: string; global_name?: string; username: string };
  lobby_channel_id: string;
};

async function fetchMe(token: string): Promise<Me | null> {
  const res = await fetch(`/app/me?token=${encodeURIComponent(token)}`);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me: ${res.status}`);
  return res.json() as Promise<Me>;
}

function UnknownLink() {
  return (
    <SiteFrame>
      <div className={classes.notice}>
        <h1 className={classes.heading}>This link is not recognised</h1>
        <p className={classes.note}>
          Ask your host for a fresh player link and open it on this device.
        </p>
      </div>
    </SiteFrame>
  );
}

/**
 * Every signed-in route (/play, /game/:id) shares one live connection, opened
 * here so moving between them is instant. Modals and toasts from the bot can
 * arrive anywhere, so their hosts live here too.
 */
export function PlayerLayout() {
  const [token] = useState(adoptTokenFromUrl);
  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => fetchMe(token!),
    enabled: !!token,
    staleTime: Infinity,
    retry: 2,
  });

  if (!token) return <Navigate to="/" replace />;
  if (me.data === null) return <UnknownLink />;

  return (
    <PlayProvider token={token}>
      <Outlet />
      <ModalHost />
      <Toasts />
    </PlayProvider>
  );
}

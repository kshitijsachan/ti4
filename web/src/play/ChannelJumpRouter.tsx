import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePlay } from "@/discord";
import { gameOfChannel, lobbyChannel } from "@/play/games";
import { useChannelJump } from "@/play/channelJump";

/**
 * Routes a channel jump to the page that shows it: the owning game's screen
 * (whose sidebar then opens the channel) or the home page for the lobby.
 */
export function ChannelJumpRouter() {
  const target = useChannelJump((s) => s.target);
  const clear = useChannelJump((s) => s.clear);
  const channels = usePlay((s) => s.channels);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!target) return;
    if (lobbyChannel(channels)?.id === target) {
      clear();
      navigate("/play");
      return;
    }
    const game = gameOfChannel(channels, target);
    if (!game) {
      clear();
      return;
    }
    const path = `/game/${game.name}`;
    if (pathname !== path) navigate(path);
  }, [target, channels, pathname, navigate, clear]);

  return null;
}

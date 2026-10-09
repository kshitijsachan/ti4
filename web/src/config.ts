/**
 * Every backend call is same-origin. The shim (shim/src/index.ts) proxies
 * `/bot/*` to the AsyncTI4 bot's Spring API and STOMP socket, and serves the
 * site endpoints under `/app/*`. In dev, vite.config.ts forwards the same paths.
 */
function wsOrigin() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`;
}

export const config = {
  api: {
    gameDataUrl: "/bot/api/public/game",
    botApiUrl: "/bot/api",
    get websocketUrl() {
      return `${wsOrigin()}/bot/ws`;
    },
    get appSocketUrl() {
      return `${wsOrigin()}/app/ws`;
    },
  },
};

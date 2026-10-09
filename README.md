# TI4 Online

Play Twilight Imperium 4 (base, Prophecy of Kings, Codices, Thunder's Edge) with friends in the browser.
Send each friend a link; no accounts.

The rules engine is the [AsyncTI4 bot](https://github.com/AsyncTI4/TI4_map_generator_bot), run against a
self-hosted Discord stand-in, with a web client built on [ti4_web_new](https://github.com/AsyncTI4/ti4_web_new).
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

One Ubuntu VM with 8 GB of RAM runs everything in Docker: postgres, the bot and the site.
4 GB also works with `BOT_MEMORY=2500m`. amd64 and arm64 are both supported.

```sh
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/kshitijsachan/ti4.git /opt/ti4
sudo /opt/ti4/deploy/deploy.sh                        # http://<server-ip>:8090
# or, with a domain pointed at the server (automatic HTTPS):
sudo DOMAIN=ti4.example.com /opt/ti4/deploy/deploy.sh
```

The script installs Docker, builds the images (~15 min the first time) and starts the stack.
It then prints the **admin link**. Open it to create players and copy their links. Re-run it to update.

- Where to host it, with costs and step-by-step instructions: [deploy/HOSTING.md](deploy/HOSTING.md).
  The recommendation is a Hetzner CAX21 at ~€8/mo. Free options: Oracle Always Free, or a home PC with Cloudflare Tunnel.
- Manual control: `cd deploy && cp .env.example .env && docker compose up -d --build`. Optional profiles:
  `https` (Caddy + Let's Encrypt), `tunnel` / `quicktunnel` (Cloudflare Tunnel).
- Images: `deploy/bot.Dockerfile` fetches upstream AsyncTI4 at `bot/UPSTREAM_COMMIT`, applies `bot/patches`,
  builds it and bundles the art. `deploy/app.Dockerfile` builds the web client and the shim.
- The bot reads its fake-Discord credentials from the shim's `state.json`, which is shared read-only through
  the `shimdata` volume. Game data lives in the `pgdata`, `botstorage` and `shimdata` volumes.

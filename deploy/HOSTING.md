# Hosting TI4 Online

What the stack needs (one machine runs everything via `deploy/docker-compose.yml`):

| piece | RAM | notes |
|---|---|---|
| bot (AsyncTI4, Java) | 2–3 GB | `BOT_MEMORY` (default `3g`); heap = 75% of that |
| postgres 16 | ~100–300 MB | capped at 512 MB |
| shim + web | ~150–400 MB | capped at 768 MB |
| **total** | **~4 GB in use, 8 GB box recommended** | 4 GB works with `BOT_MEMORY=2500m` + swap (deploy.sh adds 4 GB swap on small boxes) |
| disk | ~5 GB images + game data | 20 GB+ disk is plenty |
| build | 2–3 GB peak (Vite, Maven), 10–20 min on 2–4 vCPU | |

All images are multi-arch (amd64 and arm64), so ARM servers (Oracle Ampere, Hetzner CAX) work.

## Recommendation

**Primary: a Hetzner Cloud ARM server, CAX21 (4 vCPU, 8 GB RAM), about €8/month.** It's cheap and always on.
It also has none of the capacity lotteries or idle-reclaim rules of the free tiers. Run one command and you're done.
If CAX isn't orderable in your region, any ≥8 GB Ubuntu VPS works the same way: Hetzner CX33, or another
provider. If you want 4 GB to save money, use CAX11/CX23 with `BOT_MEMORY=2500m`.

**Free alternative: Oracle Cloud Always Free, Ampere A1 (2 OCPU / 12 GB as of mid-2026).** That is enough RAM.
It costs $0, but expect "out of capacity" errors when creating the VM, and Oracle can reclaim idle free instances.

**No server at all: a home PC + Cloudflare Tunnel.** It's free and needs no port forwarding, but it's only up while your PC is on.

Prices change often: Hetzner raised cloud prices twice in 2026 (April and June 15). Check the live
price page before you buy.

## Comparison (checked Oct 2026)

| option | monthly cost | RAM | fits? | effort | caveats |
|---|---|---|---|---|---|
| **Hetzner CAX21** (ARM, 4 vCPU/8 GB/80 GB) | ~€7.99 + VAT (+ ~€0.50 IPv4) after the June 2026 increase [1][2] | 8 GB | yes, comfortably | low | "Cost-Optimized" CX/CAX lines have been shown as "currently not available" in some locations since mid-2026 [3]; EU/US/SG only |
| Hetzner CAX11 / CX23 (2 vCPU/4 GB) | ~€5.99 / ~€5.49 + VAT [2] | 4 GB | tight (set `BOT_MEMORY=2500m`, swap) | low | same availability caveat |
| **Oracle Always Free** A1.Flex | $0 | 12 GB (was 24 GB until mid-2026) [4][5] | yes | medium (signup with card, capacity retries, firewall) | A1 capacity often exhausted [6]; idle free instances can be reclaimed; Oracle cut the allowance in 2026 without notice and may again |
| Fly.io | ~$21–22 for one shared-cpu-2x 4 GB machine, + volumes $0.15/GB, + $2 IPv4 [7] | pay per GB | yes, with work | high: no docker-compose; split into apps/machines, Postgres separately | most expensive per GB |
| Railway (Hobby) | $5 minimum + usage; RAM ≈ $10/GB-month → ~$35–45 for ~4 GB [8][9] | pay per GB | yes | medium (3 services from Dockerfiles + volumes) | costly for an always-on 3 GB JVM |
| Home machine + Cloudflare Tunnel | $0 (+ ~$10/yr domain for a stable URL) | your PC | yes | low–medium | up only while the PC is on; quick tunnels are test-only with random URLs [10] |

Sources:
[1] [prismix.dev mirror of Hetzner price-adjustment table](https://prismix.dev/news/e099eaeb0874) ·
[2] [privatedevops.com: Hetzner June 2026 repricing](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do), [Hetzner docs: price adjustment](https://docs.hetzner.com/de/general/infrastructure-and-availability/price-adjustment/) ·
[3] [vincentschmalbach.com: cheap Hetzner cloud unavailable](https://www.vincentschmalbach.com/hetzner-cheap-cloud-unavailable-price-increases/) ·
[4] [Oracle docs: Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) ·
[5] [InfoQ: Oracle cloud free tier limits (Jul 2026)](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Linuxiac: Oracle cuts A1 in half](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/) ·
[6] [Oracle community: A1 capacity threads](https://community.oracle.com/customerconnect/discussions/tagged/arm) ·
[7] [Fly.io pricing](https://fly.io/docs/about/pricing/) ·
[8] [Railway pricing](https://railway.com/pricing), [Railway hobby RAM pricing thread](https://station.railway.com/questions/hobby-plan-pricing-per-gb-of-memory-b4d7046c) ·
[9] [servercompass.app: Railway pricing 2026](https://servercompass.app/blog/railway-pricing-what-youll-actually-pay) ·
[10] [Cloudflare: Quick Tunnels (TryCloudflare)](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

Third-party price reports disagree in places (e.g. the CX23 price). Treat the figures as approximate and
confirm on the provider's page at signup.

---

## Path A (recommended): Hetzner Cloud

You do: create the account (email, payment method, possibly ID verification).

1. On your own computer, if you don't have an SSH key yet: `ssh-keygen -t ed25519` (press Enter through it), then
   `cat ~/.ssh/id_ed25519.pub` and copy the line.
2. In <https://console.hetzner.cloud>: **New project** → open it → **Add Server**:
   - Location: closest to your friends (Falkenstein/Nuremberg/Helsinki, or Ashburn/Hillsboro).
   - Image: **Ubuntu 24.04**.
   - Type: **Shared vCPU → Arm64 (Ampere) → CAX21** (or x86 CX33; any 8 GB type).
   - Networking: keep Public IPv4 on.
   - SSH keys: **Add SSH key** → paste the line from step 1.
   - Firewalls (optional, recommended): create one allowing inbound TCP **22**, **8090** (and **80, 443** if
     you will use a domain).
   - **Create & Buy now**. Copy the server's IPv4.
3. From your computer:
   ```sh
   ssh root@<SERVER_IP>
   ```
4. On the server (copy-paste):
   ```sh
   apt-get update && apt-get install -y git
   git clone https://github.com/kshitijsachan/ti4.git /opt/ti4
   /opt/ti4/deploy/deploy.sh
   ```
   If the repo is private, use `git clone https://<github-user>:<personal-access-token>@github.com/kshitijsachan/ti4.git /opt/ti4`
   (fine-grained token with read-only Contents access to this repo).
5. When it finishes (~15 min the first time), it prints the **admin link** (`http://<SERVER_IP>:8090/admin?key=...`).
   Open it, create players, send each friend their link. The bot needs a few more minutes on first start
   before games can be created (`docker compose -f /opt/ti4/deploy/docker-compose.yml logs -f bot`).

Optional HTTPS with a domain: create a DNS **A record** `ti4.yourdomain.com → <SERVER_IP>`, open ports 80 and 443,
then run `DOMAIN=ti4.yourdomain.com /opt/ti4/deploy/deploy.sh`. Caddy gets a Let's Encrypt certificate
automatically. The admin link becomes `https://ti4.yourdomain.com/admin?key=...`.

## Path B (free): Oracle Cloud Always Free

You do: sign up at <https://signup.cloud.oracle.com> (a card is required for verification; Always Free
resources are not charged). **Pick your home region carefully, because it can't be changed later**, and A1 capacity varies by
region.

1. Make an SSH key as in Path A step 1.
2. Console → **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04** (pick the aarch64 build when asked).
   - Shape: **Change shape → Ampere → VM.Standard.A1.Flex**, **2 OCPUs, 12 GB** memory (the current Always
     Free maximum; check the "Always Free-eligible" label).
   - Networking: create a new VCN with a public subnet; **Assign a public IPv4 address**.
   - SSH keys: paste your public key.
   - Boot volume: default (~47 GB) is fine (Always Free includes 200 GB block storage total).
   - **Create**. If you get **"Out of capacity for shape VM.Standard.A1.Flex"**, try another availability
     domain, retry later (early morning tends to work), or try again over a few days.
3. Open the port: Instance → **Subnet** → **Default Security List** → **Add Ingress Rules**: Source CIDR
   `0.0.0.0/0`, TCP, destination port **8090** (and another for **80,443** if using a domain).
4. `ssh ubuntu@<PUBLIC_IP>`, then:
   ```sh
   sudo apt-get update && sudo apt-get install -y git
   sudo git clone https://github.com/kshitijsachan/ti4.git /opt/ti4
   sudo BOT_MEMORY=6g /opt/ti4/deploy/deploy.sh
   ```
   deploy.sh also opens the ports in Oracle's Ubuntu iptables rules. `BOT_MEMORY=6g` uses the spare RAM.
   It also keeps memory use above Oracle's idle-reclaim threshold.
5. Open the printed admin link.

Idle reclamation: Oracle may stop Always Free instances that look idle (very low CPU/network/memory
utilization over 7 days). A running bot with a 6 GB heap usually stays above the memory threshold. Upgrading the
account to Pay-As-You-Go removes reclamation, but reports from mid-2026 say A1 usage above the free 2 OCPU/12 GB is then
billed. Stay at 2 OCPU/12 GB.

## Path C (free, your own PC): Cloudflare Tunnel

Needs: a PC that stays on (Linux, or Windows/macOS with Docker Desktop) with 8 GB+ RAM. No router changes.

1. Install Docker (Linux: `curl -fsSL https://get.docker.com | sudo sh`; else Docker Desktop).
2. `git clone https://github.com/kshitijsachan/ti4.git && cd ti4/deploy && cp .env.example .env`
3. Pick one:
   - **Quick test, no account**: `docker compose --profile quicktunnel up -d --build`, then
     `docker compose logs cloudflared-quick | grep trycloudflare` shows `https://<random>.trycloudflare.com`.
     Get the admin key with `docker compose logs shim | grep "admin link"`, then open
     `https://<random>.trycloudflare.com/admin?key=<key>`. The URL changes whenever the tunnel restarts, and
     Cloudflare calls quick tunnels test-only. Fine for one evening.
   - **Stable URL (free Cloudflare account + a domain on Cloudflare)**: Cloudflare dashboard → **Zero Trust →
     Networks → Tunnels → Create a tunnel** (Cloudflared) → copy the **token** → add a **Public hostname**
     `ti4.yourdomain.com` → service **HTTP** `shim:8090`. In `deploy/.env` set
     `CLOUDFLARE_TUNNEL_TOKEN=<token>`, `PUBLIC_URL=https://ti4.yourdomain.com`, `SHIM_BIND=127.0.0.1`, then
     `docker compose --profile tunnel up -d --build`.
4. Open the admin link (`docker compose logs shim | grep "admin link"`).

WebSockets (the live game connection) work through Cloudflare Tunnel with no extra settings.

## Not recommended here

- **Fly.io** has no docker-compose. You'd run the bot, the shim and Postgres as separate apps/machines and wire
  volumes and private networking yourself. It costs ~$25–30/month for the RAM involved.
- **Railway** can deploy the three services from the Dockerfiles in `deploy/` with volumes. Usage pricing
  (~$10/GB-month RAM) makes an always-on 3 GB JVM cost ~$35–45/month.

## Day-2 operations (any VM)

```sh
cd /opt/ti4/deploy
docker compose ps                      # health of postgres / shim / bot
docker compose logs -f bot             # bot log
docker compose logs shim | grep "admin link"
sudo /opt/ti4/deploy/deploy.sh         # update to latest code (git pull + rebuild); data is kept
docker compose restart bot
```

Backup (all game state lives in three Docker volumes):
```sh
cd /opt/ti4/deploy && docker compose stop
for v in shimdata botstorage pgdata; do
  docker run --rm -v ti4_$v:/v -v "$PWD":/b alpine tar czf /b/backup-$v.tgz -C /v .
done
docker compose start
```
Restore: create the volumes and untar into them the same way (`tar xzf ... -C /v`) before `up`.

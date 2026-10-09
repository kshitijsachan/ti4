#!/usr/bin/env python3
"""
Saves real bot prompts from the shim's store as decision-popup fixtures.

    python3 -I src/decisions/dev/extract.py <id> <game> <player name> <message id> [--web] [--hand]

Writes src/decisions/dev/fixtures/<id>.json: the prompt as the player's browser would receive it, the game's
channels and users, the recent history of the prompt's channel and of the action log (agenda context), and,
with --web, the game's current web-data (strategy cards, units, command tokens) from the shim's /bot proxy.
"""
import json
import os
import sys
import urllib.request

STATE = os.environ.get("SHIM_STATE", "/home/user/run/shim-data/state.json")
SHIM = os.environ.get("SHIM_URL", "http://127.0.0.1:8090")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def view(msg, user_id):
    out = {k: v for k, v in msg.items() if not k.startswith("_") and k not in ("member", "sticker_items", "poll")}
    if msg.get("_ephemeral_for"):
        out["ephemeral"] = True
    if msg.get("_prompted_for"):
        out["prompted_user_id"] = msg["_prompted_for"]
    press = (msg.get("_presses") or {}).get(user_id)
    if press:
        out["my_press"] = press
    return out


def custom_ids(components):
    for c in components or []:
        if c.get("custom_id"):
            yield c["custom_id"]
        yield from custom_ids(c.get("components"))
        if c.get("accessory"):
            yield from custom_ids([c["accessory"]])


def latest(s, game, uid, pattern, player):
    """Newest message of the game (visible to the player) with a control whose custom id matches the regex."""
    import re

    rx = re.compile(pattern)
    best = None
    for cid, msgs in s["messages"].items():
        name = s["channels"].get(cid, {}).get("name", "")
        if not (name.startswith(f"{game}-") or f"-{game}-" in name):
            continue
        if "cards info" in name.lower() and not name.endswith(f"-{player}"):
            continue
        for m in msgs:
            if m.get("_ephemeral_for") not in (None, uid):
                continue
            if any(rx.search(i) for i in custom_ids(m.get("components"))) and (not best or int(m["id"]) > int(best)):
                best = m["id"]
    if not best:
        sys.exit(f"no message matching {pattern}")
    return best


def main():
    fid, game, player, message_id = sys.argv[1:5]
    flags = set(sys.argv[5:])
    s = json.load(open(STATE))
    user = next(u for u in s["users"].values() if (u.get("global_name") or u["username"]) == player)
    uid = user["id"]
    if message_id.startswith("latest:"):
        message_id = latest(s, game, uid, message_id[len("latest:"):], player)
    channel_id = next(cid for cid, msgs in s["messages"].items() if any(m["id"] == message_id for m in msgs))
    game_channels = [c for c in s["channels"].values() if c["name"].startswith(f"{game}-") or f"-{game}-" in c["name"]]
    if s["channels"][channel_id] not in game_channels:
        game_channels.append(s["channels"][channel_id])
    actions = next(c for c in game_channels if c["name"] == f"{game}-actions")

    def history(cid, upto=None, n=60):
        msgs = [m for m in s["messages"].get(cid, []) if not m.get("_ephemeral_for") or m["_ephemeral_for"] == uid]
        if upto:
            idx = next(i for i, m in enumerate(msgs) if m["id"] == upto)
            msgs = msgs[: idx + 1]
        return [view(m, uid) for m in msgs[-n:]]

    messages = {channel_id: history(channel_id, message_id)}
    if actions["id"] != channel_id:
        messages[actions["id"]] = history(actions["id"], n=120)
    users = list(s["users"].values())
    for u in users:
        u["roles"] = s["members"].get(u["id"], {}).get("roles", [])
    fixture = {
        "id": fid,
        "game": game,
        "meId": uid,
        "channelId": channel_id,
        "messageId": message_id,
        "channels": game_channels,
        "users": users,
        "roles": list(s["roles"].values()),
        "messages": messages,
    }
    if "--own" in flags:
        fixture["ownCall"] = True
    if "--web" in flags:
        with urllib.request.urlopen(f"{SHIM}/bot/api/public/game/{game}/web-data") as r:
            fixture["web"] = json.load(r)
    if "--hand" in flags:
        token = next(t for t, seat in s["seats"].items() if seat.get("user_id") == uid)
        req = urllib.request.Request(f"{SHIM}/bot/api/game/{game}/hand", headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req) as r:
            fixture["hand"] = json.load(r).get("actionCards", [])
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{fid}.json"), "w") as f:
        json.dump(fixture, f, separators=(",", ":"))
    print(f"wrote {fid}: #{s['channels'][channel_id]['name']} as {player}")


if __name__ == "__main__":
    main()

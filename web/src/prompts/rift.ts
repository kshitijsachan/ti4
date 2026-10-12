import type { PlayState } from "@/discord";

/**
 * Whether the gravity-rift roll of the current tactical action was already taken: the bot's rift prompt or a rift die
 * result posted in this channel since the newest activation. The bot keeps offering the roll button after it.
 */
export function riftRolled(state: Pick<PlayState, "messages">, channelId: string): boolean {
  const data = state.messages[channelId];
  if (!data) return false;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot) continue;
    if (/\bactivated \d+\b/i.test(m.content)) return false;
    if (/\bis rifting some units\b|\bin tile \w+ rolled a\b/i.test(m.content)) return true;
  }
  return false;
}

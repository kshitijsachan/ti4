import { create } from "zustand";

type ChannelJump = {
  /** A channel someone clicked a `<#channel>` mention or link for. */
  target: string | null;
  jump: (channelId: string) => void;
  clear: () => void;
};

/** Hand-off between the play module's channel links and the game screen. */
export const useChannelJump = create<ChannelJump>((set) => ({
  target: null,
  jump: (channelId) => set({ target: channelId }),
  clear: () => set({ target: null }),
}));

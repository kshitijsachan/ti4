import { useState, type ReactNode } from "react";
import { Button, Modal, type ButtonProps } from "@mantine/core";
import { IconBook2 } from "@tabler/icons-react";
import { FactionSheet } from "./FactionSheet";
import type { FactionPlayer } from "./types";
import styles from "./FactionSheet.module.css";

type Props = {
  faction: string;
  player?: FactionPlayer;
  playerColor?: string;
  /** Button content; defaults to "Faction sheet". */
  children?: ReactNode;
} & Omit<ButtonProps, "children">;

/** A small button that opens the faction reference sheet in a modal. */
export function FactionSheetButton({ faction, player, playerColor, children, ...buttonProps }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="compact-xs"
        variant="subtle"
        color="gray"
        leftSection={<IconBook2 size={14} />}
        onClick={() => setOpen(true)}
        {...buttonProps}
      >
        {children ?? "Faction sheet"}
      </Button>
      <FactionSheetModal
        opened={open}
        onClose={() => setOpen(false)}
        faction={faction}
        player={player}
        playerColor={playerColor}
      />
    </>
  );
}

type ModalProps = {
  opened: boolean;
  onClose: () => void;
  faction: string;
  player?: FactionPlayer;
  playerColor?: string;
};

/** The sheet in a Mantine modal, for callers with their own trigger. */
export function FactionSheetModal({ opened, onClose, faction, player, playerColor }: ModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="min(1080px, 94vw)"
      withCloseButton
      title="Faction reference"
      classNames={{ body: styles.modalBody }}
      zIndex="calc(var(--z-app-modal) + 10)"
    >
      {opened && <FactionSheet faction={faction} player={player} playerColor={playerColor} />}
    </Modal>
  );
}

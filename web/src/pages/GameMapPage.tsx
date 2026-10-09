import type { ReactNode } from "react";
import { SettingsModal } from "@/domains/settings/components/SettingsModal";
import { SystemDossierModal } from "@/domains/map/components/SystemDossier/SystemDossierModal";
import { KeyboardShortcutsModal } from "@/domains/game-shell/components/KeyboardShortcutsModal";
import { GameContextProvider } from "@/state/GameContextProvider";
import { useSettingsStore } from "@/state/appStore";
import { isMobileDevice } from "@/utils/isTouchDevice";
import { usePageThemeClass } from "@/hooks/usePageThemeClass";

type Props = { gameId: string; children: ReactNode };

/**
 * The live game document (web-data over STOMP), the page theme, and the
 * upstream map's own dialogs (display settings, system dossier, shortcuts),
 * around whatever the game screen lays out on top of it.
 */
export default function GameMapPage({ gameId, children }: Props) {
  const themeClassName = usePageThemeClass({ mobile: isMobileDevice() });
  const settings = useSettingsStore((state) => state.settings);
  const handlers = useSettingsStore((state) => state.handlers);

  return (
    <GameContextProvider gameId={gameId}>
      <div className={themeClassName}>
        {children}
        <SettingsModal
          opened={settings.settingsModalOpened}
          onClose={() => handlers.setSettingsModalOpened(false)}
        />
        <SystemDossierModal />
        <KeyboardShortcutsModal
          opened={settings.keyboardShortcutsModalOpened}
          onClose={() => handlers.setKeyboardShortcutsModalOpened(false)}
        />
      </div>
    </GameContextProvider>
  );
}

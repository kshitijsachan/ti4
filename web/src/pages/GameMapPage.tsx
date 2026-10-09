import { useState, type ComponentType, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { AppShell, Box, Tabs, SimpleGrid } from "@mantine/core";
import { GameHeader } from "@/play/GameHeader";
import classes from "@/shared/ui/map/MapUI.module.css";
import ScoreBoard from "@/domains/objectives/components/ScoreBoard/ScoreBoard";
import { SettingsModal } from "@/domains/settings/components/SettingsModal";
import { SystemDossierModal } from "@/domains/map/components/SystemDossier/SystemDossierModal";
import { KeyboardShortcutsModal } from "@/domains/game-shell/components/KeyboardShortcutsModal";
import { GameContextProvider } from "@/state/GameContextProvider";
import { useSettingsStore } from "@/state/appStore";
import {
  useGameData as useGameContext,
  useGameDataState,
} from "@/state/useGameContext";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import { TabsControls } from "@/domains/game-shell/components/TabsControls";
import GeneralArea from "@/domains/game-shell/components/GeneralArea";
import { PannableMapView } from "@/domains/game-shell/components/layouts/PannableMapView";
import { MapView } from "@/domains/game-shell/components/layouts/MapView";
import { MapLoadingState } from "@/domains/map/components/MapLoadingState";
import { MapViewportLoader } from "@/shared/ui/primitives/MapViewportLoader";
import { isMobileDevice } from "@/utils/isTouchDevice";
import { usePageThemeClass } from "@/hooks/usePageThemeClass";
import { PlayerDataErrorAlert } from "@/shared/ui/PlayerDataErrorAlert";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import { MAIN_TAB_CONFIGS } from "@/domains/game-shell/components/mainTabs";
import { TabPanelSection } from "@/domains/game-shell/components/TabPanelSection";
import { APP_HEADER_HEIGHT } from "@/shared/ui/AppHeader";
import { TabActiveContext } from "@/hooks/useIsTabActive";

type ContentProps = {
  pannable: boolean;
  /** Takes the map tab's place, e.g. the draft or the setup log before a board exists. */
  mapOverride?: GameViewTab | null;
  /** Extra views next to the upstream ones (after Map). */
  extraTabs?: GameViewTab[];
};

export type GameViewTab = {
  value: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  node: ReactNode;
};

type TabContentProps = {
  gameId: string;
  ready: boolean;
  isError: boolean;
  children: ReactNode;
};

/**
 * Every tab reads the same web-data document, so they all wait and fail the same
 * way. Without this they rendered an empty panel for both, which is why a slow
 * load and a dead game looked identical.
 */
function TabContent({ gameId, ready, isError, children }: TabContentProps) {
  if (ready) return <>{children}</>;
  if (isError) return <PlayerDataErrorAlert gameId={gameId} />;
  return <MapViewportLoader label="Acquiring game state" />;
}

function GameMapContent({
  pannable,
  mapOverride,
  extraTabs = [],
}: ContentProps) {
  const data = useGameContext();
  const gameDataState = useGameDataState();
  const isError = !!gameDataState?.isError;
  const params = useParams<{ mapid: string }>();
  const gameId = params.mapid!;

  const settings = useSettingsStore((state) => state.settings);
  const handlers = useSettingsStore((state) => state.handlers);

  const [activeTab, setActiveTab] = useState("map");
  // Tabs mount on first visit and then stay mounted (hidden), so switching back
  // to the map doesn't rebuild ~10k components every time.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["map"]));

  const changeActiveTab = (value: string) => {
    setActiveTab(value);
    setVisitedTabs((prev) =>
      prev.has(value) ? prev : new Set(prev).add(value),
    );
  };

  // The tab title (whose turn, prompts waiting) is owned by the game screen: see useTurnAlerts.

  const extraValues = new Set(extraTabs.map((t) => t.value));
  const shownTab =
    activeTab.startsWith("x-") && !extraValues.has(activeTab)
      ? "map"
      : activeTab;

  return (
    <AppShell header={{ height: APP_HEADER_HEIGHT }}>
      <GameHeader gameId={gameId} />

      <AppShell.Main>
        <Box className={classes.mainBackground}>
          <Tabs
            value={shownTab}
            onChange={(value) => changeActiveTab(value || "map")}
            h={{ base: "100vh", sm: "calc(100vh - var(--app-header-height))" }}
            keepMounted
          >
            <Tabs.List className={classes.tabsList}>
              {MAIN_TAB_CONFIGS.map((tab) => {
                if (tab.hideOnMobile && isMobileDevice()) {
                  return null;
                }

                const override = tab.value === "map" ? mapOverride : null;
                const Icon = override?.Icon ?? tab.Icon;
                return [
                  <Tabs.Tab
                    key={tab.value}
                    value={tab.value}
                    className={classes.tabsTab}
                    leftSection={<Icon size={16} />}
                    visibleFrom={tab.visibleFrom}
                  >
                    {override?.label ?? tab.label}
                  </Tabs.Tab>,
                  ...(tab.value === "map"
                    ? extraTabs.map((extra) => (
                        <Tabs.Tab
                          key={extra.value}
                          value={extra.value}
                          className={classes.tabsTab}
                          leftSection={<extra.Icon size={16} />}
                          visibleFrom="sm"
                        >
                          {extra.label}
                        </Tabs.Tab>
                      ))
                    : []),
                ];
              })}
              <TabsControls
                onTryDecalsClick={() =>
                  window.dispatchEvent(new CustomEvent("toggleTryDecals"))
                }
              />
            </Tabs.List>

            {/* Map Tab
                The board, both HUD decks and the floating controls only mount
                over real data — chrome calibrated to nothing is the artifact
                this replaces. */}
            <Tabs.Panel value="map" h="calc(100% - var(--map-tabs-height))">
              <TabActiveContext value={shownTab === "map"}>
                {mapOverride ? (
                  mapOverride.node
                ) : !data ? (
                  <MapLoadingState gameId={gameId} />
                ) : pannable ? (
                  <PannableMapView />
                ) : (
                  <MapView gameId={gameId} />
                )}
              </TabActiveContext>
            </Tabs.Panel>

            {extraTabs.map((extra) => (
              <Tabs.Panel
                key={extra.value}
                value={extra.value}
                h="calc(100% - var(--map-tabs-height))"
              >
                {shownTab === extra.value && extra.node}
              </Tabs.Panel>
            ))}

            <TabPanelSection
              value="players"
              className={classes.playersTabContent}
              visited={visitedTabs.has("players")}
            >
              <TabContent
                gameId={gameId}
                ready={!!data?.playerData}
                isError={isError}
              >
                <SimpleGrid cols={{ base: 1, md: 2, xl2: 3 }} spacing="sm">
                  {filterPlayersWithAssignedFaction(data?.playerData ?? []).map(
                    (player) => (
                      <PlayerCard key={player.color} playerData={player} />
                    ),
                  )}
                </SimpleGrid>
              </TabContent>
            </TabPanelSection>

            <TabPanelSection
              value="objectives"
              className={classes.playersTabContent}
              visited={visitedTabs.has("objectives")}
            >
              <TabContent gameId={gameId} ready={!!data} isError={isError}>
                <ScoreBoard />
              </TabContent>
            </TabPanelSection>

            <TabPanelSection
              value="general"
              className={classes.playersTabContent}
              visited={visitedTabs.has("general")}
            >
              <TabContent gameId={gameId} ready={!!data} isError={isError}>
                <GeneralArea />
              </TabContent>
            </TabPanelSection>
          </Tabs>
        </Box>
      </AppShell.Main>

      <SettingsModal
        opened={settings.settingsModalOpened}
        onClose={() => handlers.setSettingsModalOpened(false)}
      />

      <SystemDossierModal />

      <KeyboardShortcutsModal
        opened={settings.keyboardShortcutsModalOpened}
        onClose={() => handlers.setKeyboardShortcutsModalOpened(false)}
      />
    </AppShell>
  );
}

type Props = Pick<ContentProps, "mapOverride" | "extraTabs">;

/** The upstream board view: map, player areas, objectives, general. */
function GameMapPage({ mapOverride, extraTabs }: Props) {
  const params = useParams<{ mapid: string }>();
  const gameId = params.mapid!;
  const themeClassName = usePageThemeClass({ mobile: isMobileDevice() });
  const mapViewPreference = useSettingsStore(
    (state) => state.settings.mapViewPreference,
  );
  const effectivePannable = isMobileDevice() || mapViewPreference !== "panels";

  return (
    <>
      <GameContextProvider gameId={gameId}>
        <div className={themeClassName}>
          <GameMapContent
            pannable={effectivePannable}
            mapOverride={mapOverride}
            extraTabs={extraTabs}
          />
        </div>
      </GameContextProvider>
    </>
  );
}

export default GameMapPage;

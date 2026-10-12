import { Modal, Tabs } from "@mantine/core";
import ScoreBoard from "@/domains/objectives/components/ScoreBoard/ScoreBoard";
import GeneralArea from "@/domains/game-shell/components/GeneralArea";
import { ExpeditionsBoard } from "@/domains/map/components/ExpeditionLayer";
import { useGameData } from "@/state/useGameContext";
import classes from "./ObjectivesModal.module.css";

type Props = { opened: boolean; onClose: () => void };

/** Public objectives and who has scored them; the rest of the shared table (cards, laws) one tab over. */
export function ObjectivesModal({ opened, onClose }: Props) {
  const data = useGameData();
  const hasExpeditions = Object.keys(data?.expeditions ?? {}).length > 0;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="auto"
      centered
      zIndex={3500}
      title="Objectives & table"
      classNames={{ content: classes.content, body: classes.body }}
    >
      <Tabs defaultValue="objectives" keepMounted={false}>
        <Tabs.List className={classes.tabs}>
          <Tabs.Tab value="objectives">Objectives &amp; score</Tabs.Tab>
          <Tabs.Tab value="table">Strategy cards, laws &amp; decks</Tabs.Tab>
          {hasExpeditions && <Tabs.Tab value="expeditions">Expeditions</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="objectives" className={classes.panel}>
          <ScoreBoard />
        </Tabs.Panel>
        <Tabs.Panel value="table" className={classes.panel}>
          <GeneralArea />
        </Tabs.Panel>
        {hasExpeditions && (
          <Tabs.Panel value="expeditions" className={`${classes.panel} ${classes.expeditions}`}>
            <ExpeditionsBoard />
            <p className={classes.note}>A faction&apos;s control token marks each expedition it has completed.</p>
          </Tabs.Panel>
        )}
      </Tabs>
    </Modal>
  );
}

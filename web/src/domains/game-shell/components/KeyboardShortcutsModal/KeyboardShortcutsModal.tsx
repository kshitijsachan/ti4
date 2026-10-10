import { Title, Text, Box, Grid, Group } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./KeyboardShortcutsModal.module.css";
import { AppModal } from "@/shared/ui/AppModal";

type KeyboardShortcutsModalProps = {
  opened: boolean;
  onClose: () => void;
};

/* A section rail: engraved label carried across the column by a fading rule. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.sectionTitle}>
      {children}
      <span className={classes.sectionRule} aria-hidden="true" />
    </Box>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return <kbd className={classes.key}>{children}</kbd>;
}

type ShortcutItemProps = {
  keys: string | string[];
  description: string;
  /** True when the keys are a contiguous run rather than alternatives. */
  range?: boolean;
};

function ShortcutItem({ keys, description, range = false }: ShortcutItemProps) {
  const keyArray = Array.isArray(keys) ? keys : [keys];

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      align="center"
      className={classes.shortcutItem}
    >
      <Text className={classes.description}>{description}</Text>
      <Box className={range ? classes.keyRange : classes.keyContainer}>
        {keyArray.map((key, index) => (
          <Box key={key} className={classes.keyContainer}>
            {!range && index > 0 && (
              <span className={classes.alt} aria-hidden="true">
                /
              </span>
            )}
            <Keycap>{key}</Keycap>
          </Box>
        ))}
      </Box>
    </Group>
  );
}

export function KeyboardShortcutsModal({
  opened,
  onClose,
}: KeyboardShortcutsModalProps) {
  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        <Title order={3} size="h4">
          Keyboard Shortcuts
        </Title>
      }
      size="lg"
    >
      <Box className={classes.content}>
        <Grid>
          <Grid.Col span={6}>
            <SectionTitle>Map view</SectionTitle>
            <Box className={classes.section}>
              <ShortcutItem keys={["+", "="]} description="Zoom in" />
              <ShortcutItem keys="-" description="Zoom out" />
              <ShortcutItem keys="0" description="Fit the whole board" />
              <ShortcutItem keys="o" description="Control overlays" />
            </Box>
          </Grid.Col>

          <Grid.Col span={6}>
            <SectionTitle>Highlight</SectionTitle>
            <Box className={classes.section}>
              <ShortcutItem keys="y" description="Planet types" />
              <ShortcutItem keys="t" description="Tech skips" />
              <ShortcutItem keys="a" description="Attachments" />
              <ShortcutItem keys="p" description="PDS coverage" />
            </Box>
          </Grid.Col>
        </Grid>

        <Box mt="lg" className={classes.note}>
          <Text className={classes.noteText}>
            Press a highlight key again to turn it off; one highlight shows at a time. Shortcuts are off
            while you are typing.
          </Text>
        </Box>
      </Box>
    </AppModal>
  );
}

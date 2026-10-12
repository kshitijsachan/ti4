import { useMemo, useState } from "react";
import { Combobox, Loader, useCombobox } from "@mantine/core";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { Channel, Component, Role, SelectOption } from "../types";
import { ComponentType } from "../types";
import { usePlay } from "../client/PlayProvider";
import { displayName } from "../client/hooks";
import { ComponentEmoji } from "./Emoji";
import classes from "./SelectControl.module.css";

type Props = {
  component: Component;
  /** Channel the select lives in; user selects then offer that game's players first. */
  channelId?: string;
  value: string[];
  onChange: (values: string[]) => void;
  /** Called when a selection is final (single pick, or "Apply" on a multi-select). */
  onCommit?: (values: string[]) => void;
  pending?: boolean;
  disabled?: boolean;
};

/** Options for user/role/mentionable/channel selects come from the game's own directory. */
function useAutoOptions(c: Component, channelId?: string): SelectOption[] {
  const users = usePlay((s) => s.users);
  const roles = usePlay((s) => s.roles);
  const channels = usePlay((s) => s.channels);
  return useMemo(() => {
    const gameRoles = gameRoleIds(channels, roles, channelId);
    const userOpts = () => {
      const humans = Object.values(users).filter((u) => !u.bot);
      const inGame = humans.filter((u) => u.roles?.some((r) => gameRoles.has(r)));
      return (inGame.length ? inGame : humans).map((u) => ({ label: displayName(u), value: u.id, description: `@${u.username}` }));
    };
    const roleOpts = () =>
      Object.values(roles)
        .filter((r) => !r.managed && r.name !== "@everyone")
        .map((r) => ({ label: `@${r.name}`, value: r.id }));
    switch (c.type) {
      case ComponentType.UserSelect:
        return userOpts();
      case ComponentType.RoleSelect:
        return roleOpts();
      case ComponentType.MentionableSelect:
        return [...userOpts(), ...roleOpts()];
      case ComponentType.ChannelSelect:
        return Object.values(channels)
          .filter((ch) => !c.channel_types?.length || c.channel_types.includes(ch.type))
          .filter((ch) => ch.type !== 4)
          .map((ch) => ({ label: `#${ch.name}`, value: ch.id }));
      default:
        return c.options ?? [];
    }
  }, [c, users, roles, channels, channelId]);
}

/** Roles granted access by a channel's (or its parent's) overwrites: in a game channel, the game's role. */
function gameRoleIds(channels: Record<string, Channel>, roles: Record<string, Role>, channelId?: string): Set<string> {
  const out = new Set<string>();
  let ch = channelId ? channels[channelId] : undefined;
  if (ch && !ch.permission_overwrites?.length && ch.parent_id) ch = channels[ch.parent_id];
  // Overwrite ids can arrive as JSON numbers (precision already lost), so match those numerically.
  const byNumber = new Map(Object.keys(roles).map((id) => [Number(id), id]));
  for (const o of ch?.permission_overwrites ?? []) {
    const id = typeof o.id === "number" ? (byNumber.get(o.id) ?? String(o.id)) : o.id;
    const role = roles[id];
    if (o.type === 0 && role && !role.managed && role.name !== "@everyone") out.add(id);
  }
  return out;
}

/** A Discord select menu (string/user/role/mentionable/channel) as a keyboard-navigable combobox. */
export function SelectControl({ component, channelId, value, onChange, onCommit, pending, disabled }: Props) {
  const options = useAutoOptions(component, channelId);
  const [search, setSearch] = useState("");
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch("");
    },
    onDropdownOpen: () => combobox.updateSelectedOptionIndex("active"),
  });
  const max = Math.max(1, component.max_values ?? 1);
  const min = component.min_values ?? 1;
  const multi = max > 1;
  const searchable = options.length > 8;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q));
  }, [options, search]);

  const selected = options.filter((o) => value.includes(o.value));

  const pick = (v: string) => {
    if (!multi) {
      onChange([v]);
      combobox.closeDropdown();
      onCommit?.([v]);
      return;
    }
    if (value.includes(v)) return onChange(value.filter((x) => x !== v));
    if (value.length >= max) return;
    onChange([...value, v]);
  };

  const apply = () => {
    combobox.closeDropdown();
    onCommit?.(value);
  };

  const label = selected.length
    ? selected.map((o) => o.label).join(", ")
    : component.placeholder || (multi ? `Choose up to ${max}` : "Make a selection");

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={pick}
      withinPortal
      position="bottom-start"
      offset={4}
      classNames={{ dropdown: `ti4play ${classes.dropdown}`, option: classes.option }}
      middlewares={{ flip: true, shift: true }}
      width="target"
      zIndex="var(--z-header-menu)"
    >
      <Combobox.Target>
        <button
          type="button"
          className={classes.trigger}
          data-filled={selected.length > 0 || undefined}
          disabled={disabled || component.disabled}
          aria-busy={pending}
          onClick={() => combobox.toggleDropdown()}
        >
          {selected.length === 1 && <ComponentEmoji emoji={selected[0].emoji} />}
          <span className={classes.triggerLabel}>{label}</span>
          {pending ? <Loader size={12} color="gray" /> : <IconChevronDown size={14} className={classes.chevron} />}
        </button>
      </Combobox.Target>
      <Combobox.Dropdown>
        {searchable && (
          <Combobox.Search
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Filter…"
            classNames={{ input: classes.search }}
          />
        )}
        <Combobox.Options mah={320} style={{ overflowY: "auto" }}>
          {filtered.length === 0 && <Combobox.Empty>No matches</Combobox.Empty>}
          {filtered.map((o) => {
            const active = value.includes(o.value);
            return (
              <Combobox.Option value={o.value} key={o.value} active={active} data-checked={active || undefined}>
                <ComponentEmoji emoji={o.emoji} />
                <span className={classes.optionText}>
                  <span className={classes.optionLabel}>{o.label}</span>
                  {o.description && <span className={classes.optionDesc}>{o.description}</span>}
                </span>
                {active && <IconCheck size={14} className={classes.check} />}
              </Combobox.Option>
            );
          })}
        </Combobox.Options>
        {multi && onCommit && (
          <Combobox.Footer className={classes.footer}>
            <span className={classes.count}>
              {value.length}/{max}
            </span>
            <button type="button" className={classes.apply} disabled={value.length < min} onClick={apply}>
              Apply
            </button>
          </Combobox.Footer>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}

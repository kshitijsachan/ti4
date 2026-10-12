import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Autocomplete, Loader, NumberInput, Select, TextInput } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { CommandOption, CommandOptionChoice, Snowflake } from "../types";
import { OptionType } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import { displayName } from "../client/hooks";
import {
  buildAutocompleteOptions,
  buildOptions,
  missingRequired,
  OPTION_TYPE_LABEL,
  type CommandLeaf,
  type OptionValues,
} from "./commands";
import classes from "./Composer.module.css";

type Props = {
  channelId: Snowflake;
  leaf: CommandLeaf;
  onCancel: () => void;
  onDone: () => void;
};

const inputClassNames = { input: classes.optInput, dropdown: `ti4play ${classes.optDropdown}`, option: classes.optOption };

function useDirectory(o: CommandOption) {
  const users = usePlay((s) => s.users);
  const roles = usePlay((s) => s.roles);
  const channels = usePlay((s) => s.channels);
  const userData = () => Object.values(users).filter((u) => !u.bot).map((u) => ({ value: u.id, label: displayName(u) }));
  const roleData = () =>
    Object.values(roles)
      .filter((r) => r.name !== "@everyone" && !r.managed)
      .map((r) => ({ value: r.id, label: `@${r.name}` }));
  switch (o.type) {
    case OptionType.User:
      return userData();
    case OptionType.Role:
      return roleData();
    case OptionType.Mentionable:
      return [...userData(), ...roleData()];
    case OptionType.Channel:
      return Object.values(channels)
        .filter((c) => c.type !== 4 && (!o.channel_types?.length || o.channel_types.includes(c.type)))
        .map((c) => ({ value: c.id, label: `#${c.name}` }));
    default:
      return [];
  }
}

type FieldProps = {
  o: CommandOption;
  value: string;
  onChange: (v: string) => void;
  autoFocus: boolean;
  choices: CommandOptionChoice[] | undefined;
  loadingChoices: boolean;
  onFocusAutocomplete: () => void;
};

function OptionField({ o, value, onChange, autoFocus, choices, loadingChoices, onFocusAutocomplete }: FieldProps) {
  const directory = useDirectory(o);
  const common = { autoFocus, classNames: inputClassNames, size: "xs" as const, comboboxProps: { withinPortal: true, zIndex: "var(--z-header-menu)" } };
  if (o.choices?.length) {
    return (
      <Select
        {...common}
        data={o.choices.map((c) => ({ value: String(c.value), label: c.name }))}
        value={value || null}
        onChange={(v) => onChange(v ?? "")}
        searchable
        clearable
        placeholder={o.description}
      />
    );
  }
  if (o.autocomplete) {
    return (
      <Autocomplete
        {...common}
        data={Array.from(new Set((choices ?? []).map((c) => c.name)))}
        value={value}
        onChange={onChange}
        onFocus={onFocusAutocomplete}
        placeholder={o.description}
        rightSection={loadingChoices ? <Loader size={12} color="gray" /> : null}
        filter={({ options }) => options}
        limit={25}
      />
    );
  }
  switch (o.type) {
    case OptionType.Boolean:
      return (
        <Select
          {...common}
          data={[
            { value: "true", label: "True" },
            { value: "false", label: "False" },
          ]}
          value={value || null}
          onChange={(v) => onChange(v ?? "")}
          clearable
          placeholder={o.description}
        />
      );
    case OptionType.Integer:
    case OptionType.Number:
      return (
        <NumberInput
          autoFocus={autoFocus}
          size="xs"
          classNames={{ input: classes.optInput }}
          value={value}
          onChange={(v) => onChange(String(v))}
          allowDecimal={o.type === OptionType.Number}
          min={o.min_value}
          max={o.max_value}
          placeholder={o.description}
        />
      );
    case OptionType.User:
    case OptionType.Role:
    case OptionType.Mentionable:
    case OptionType.Channel:
      return (
        <Select {...common} data={directory} value={value || null} onChange={(v) => onChange(v ?? "")} searchable clearable placeholder={o.description} />
      );
    case OptionType.Attachment:
      return <TextInput size="xs" classNames={{ input: classes.optInput }} disabled placeholder="File uploads are not supported here" />;
    default:
      return (
        <TextInput
          autoFocus={autoFocus}
          size="xs"
          classNames={{ input: classes.optInput }}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={o.description}
          maxLength={o.max_length}
        />
      );
  }
}

/** Typed option form for one slash command leaf; submits a `command` op. */
export function CommandForm({ channelId, leaf, onCancel, onDone }: Props) {
  const conn = usePlayConnection();
  const [values, setValues] = useState<OptionValues>({});
  const [choices, setChoices] = useState<Record<string, CommandOptionChoice[]>>({});
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const result = usePlay((s) => (nonce ? s.results[nonce] : undefined));
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const submitting = nonce !== null && result === undefined;

  const ordered = [...leaf.options].sort((a, b) => Number(!!b.required) - Number(!!a.required));

  useEffect(() => {
    if (result === undefined) return;
    if (result === null) return onDone();
    setError(result);
    setNonce(null);
  }, [result, onDone]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const fetchChoices = (name: string, next: OptionValues) => {
    window.clearTimeout(timer.current);
    const mine = ++seq.current;
    setLoadingFor(name);
    timer.current = window.setTimeout(() => {
      void conn.autocomplete(channelId, leaf.command.name, buildAutocompleteOptions(leaf, next, name)).then((list) => {
        if (mine !== seq.current) return;
        setChoices((prev) => ({ ...prev, [name]: list }));
        setLoadingFor(null);
      });
    }, 160);
  };

  const change = (o: CommandOption, v: string) => {
    const next = { ...values, [o.name]: v };
    setValues(next);
    if (o.autocomplete) fetchChoices(o.name, next);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const missing = missingRequired(leaf, values);
    if (missing.length) {
      setError(`Missing ${missing.map((m) => m.name).join(", ")}`);
      return;
    }
    setError(null);
    setNonce(conn.runCommand(channelId, leaf.command.name, buildOptions(leaf, values, choices)));
  };

  let label: ReactNode = null;
  if (leaf.options.length === 0) label = <div className={classes.noOptions}>No options — press Enter to run.</div>;

  return (
    <form
      className={classes.commandForm}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
      }}
    >
      <div className={classes.commandHead}>
        <span className={classes.commandPath}>/{leaf.path.join(" ")}</span>
        <span className={classes.commandDesc}>{leaf.description}</span>
        <button type="button" className={classes.iconButton} onClick={onCancel} aria-label="Cancel command">
          <IconX size={14} />
        </button>
      </div>
      {label}
      {ordered.length > 0 && (
        <div className={classes.optionGrid}>
          {ordered.map((o, i) => (
            <label key={o.name} className={classes.option}>
              <span className={classes.optionName}>
                {o.name}
                {o.required && <span className={classes.req}>*</span>}
                <span className={classes.optionType}>{OPTION_TYPE_LABEL[o.type] ?? ""}</span>
              </span>
              <OptionField
                o={o}
                value={values[o.name] ?? ""}
                onChange={(v) => change(o, v)}
                autoFocus={i === 0}
                choices={choices[o.name]}
                loadingChoices={loadingFor === o.name}
                onFocusAutocomplete={() => !choices[o.name] && fetchChoices(o.name, values)}
              />
            </label>
          ))}
        </div>
      )}
      <div className={classes.commandFoot}>
        {error ? <span className={classes.formError}>{error}</span> : <span className={classes.hint}>Enter to run · Esc to cancel</span>}
        <button type="submit" className={classes.run} disabled={submitting}>
          {submitting ? <Loader size={12} color="gray" /> : null}
          Run
        </button>
      </div>
    </form>
  );
}

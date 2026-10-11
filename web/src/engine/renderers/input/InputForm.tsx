import { useState } from "react";
import { Button, Group, MultiSelect, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import type { Decision, InputField, InputSchema } from "../../../../../shim/src/engine/types";
import classes from "./input.module.css";

/** Answer payload for typed inputs: a select (`values`) or a form submit (`inputs`). */
export type InputAnswer = { optionId: string; values?: string[]; inputs?: Record<string, string> };

export type InputRendererProps = {
  decision: Decision;
  state: unknown;
  answer: (answer: string | InputAnswer) => void;
  pendingOptionId?: string | null;
};

type Values = Record<string, string[]>;

function initialValues(schema: InputSchema): Values {
  const out: Values = {};
  for (const f of schema.fields) {
    if (f.type === "choice") out[f.id] = (f.choices ?? []).filter((c) => c.selected).map((c) => c.value);
    else out[f.id] = f.value ? [f.value] : [];
  }
  return out;
}

/** Client-side mirror of the engine's checks (the engine validates again). Null when the field is fine. */
function fieldError(f: InputField, v: string[]): string | null {
  const text = v[0] ?? "";
  if (f.type === "choice") {
    const min = f.minValues ?? 1;
    const max = f.maxValues ?? 1;
    if (v.length < min || v.length > max) return min === max ? `Pick ${min}` : `Pick ${min}–${max}`;
    return null;
  }
  if (!text) return f.required ? "Required" : null;
  if (f.type === "number" && !/^-?\d+$/.test(text.trim())) return "Whole number";
  if (f.minLength !== null && text.length < f.minLength) return `At least ${f.minLength} characters`;
  if (f.maxLength !== null && f.maxLength > 0 && text.length > f.maxLength) return `At most ${f.maxLength} characters`;
  return null;
}

function Field({ field, value, onChange }: { field: InputField; value: string[]; onChange: (v: string[]) => void }) {
  const label = field.label ?? field.placeholder ?? field.id;
  if (field.type === "choice") {
    const data = (field.choices ?? []).map((c) => ({ value: c.value, label: c.label }));
    if ((field.maxValues ?? 1) > 1)
      return (
        <MultiSelect
          size="xs"
          label={label}
          data={data}
          value={value}
          maxValues={field.maxValues ?? undefined}
          onChange={onChange}
        />
      );
    return <Select size="xs" label={label} data={data} value={value[0] ?? null} onChange={(v) => onChange(v ? [v] : [])} />;
  }
  const common = {
    size: "xs" as const,
    label,
    placeholder: field.placeholder ?? undefined,
    required: field.required,
    value: value[0] ?? "",
    maxLength: field.maxLength && field.maxLength > 0 ? field.maxLength : undefined,
  };
  if (field.multiline)
    return <Textarea {...common} autosize minRows={2} onChange={(e) => onChange([e.currentTarget.value])} />;
  return (
    <TextInput
      {...common}
      inputMode={field.type === "number" ? "numeric" : undefined}
      classNames={field.type === "number" ? { input: classes.number } : undefined}
      onChange={(e) => onChange([e.currentTarget.value])}
    />
  );
}

/** The fields of one schema plus a submit button; `submit` receives the values per field id. */
export function SchemaForm({
  schema,
  busy,
  submitLabel,
  submit,
  cancel,
}: {
  schema: InputSchema;
  busy: boolean;
  submitLabel: string;
  submit: (values: Values) => void;
  cancel?: () => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(schema));
  const errors = schema.fields.map((f) => fieldError(f, values[f.id] ?? []));
  const ok = errors.every((e) => e === null);
  return (
    <Stack gap={6} className={classes.form}>
      {schema.title && (
        <Text size="xs" fw={600} className={classes.title}>
          {schema.title}
        </Text>
      )}
      {schema.fields.map((f, i) => (
        <div key={f.id}>
          <Field field={f} value={values[f.id] ?? []} onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
          {errors[i] && (values[f.id]?.length ?? 0) > 0 && <Text className={classes.error}>{errors[i]}</Text>}
        </div>
      ))}
      <Group gap={6} justify="flex-end">
        {cancel && (
          <Button size="xs" variant="subtle" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        )}
        <Button size="xs" disabled={!ok || busy} loading={busy} onClick={() => submit(values)}>
          {submitLabel}
        </Button>
      </Group>
    </Stack>
  );
}

/** input.form: a form the engine opened for this player (a Discord modal). */
export function InputFormRenderer({ decision, answer, pendingOptionId }: InputRendererProps) {
  const schema = decision.inputs?.[0];
  if (!schema) return null;
  const busy = !!pendingOptionId;
  const toInputs = (values: Values) => {
    const out: Record<string, string> = {};
    for (const f of schema.fields) {
      const v = values[f.id] ?? [];
      if (v.length && (v.length > 1 || v[0] !== "")) out[f.id] = v.join("\n");
    }
    return out;
  };
  return (
    <SchemaForm
      schema={schema}
      busy={busy}
      submitLabel="Submit"
      submit={(values) => answer({ optionId: "submit", inputs: toInputs(values) })}
      cancel={() => answer("cancel")}
    />
  );
}

/**
 * Select menus on any decision (decision.inputs of kind "select"): one control per menu, answered with its values.
 * For legacy/area renderers that show a prompt's options; single-choice menus may still use the flat
 * "<menu>#<value>" options instead.
 */
export function SelectInputs({ decision, answer, pendingOptionId }: InputRendererProps) {
  const selects = (decision.inputs ?? []).filter((s) => s.kind === "select");
  if (!selects.length) return null;
  const busy = !!pendingOptionId;
  return (
    <Stack gap={8}>
      {selects.map((s) => (
        <SchemaForm
          key={s.id}
          schema={s}
          busy={busy}
          submitLabel="Choose"
          submit={(values) => answer({ optionId: s.id, values: values.values ?? [] })}
        />
      ))}
    </Stack>
  );
}

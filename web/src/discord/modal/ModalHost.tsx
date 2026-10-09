import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "@mantine/core";
import type { Component, ModalSubmitComponent } from "../types";
import { ComponentType } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import type { OpenModal } from "../client/store";
import { Markdown } from "../render/Markdown";
import { SelectControl } from "../render/SelectControl";
import { isSelect } from "../render/Components";
import classes from "./ModalHost.module.css";

type Values = Record<string, string[]>;

/** Field descriptor flattened from either legacy rows (1 → 4) or labels (18 → input/select). */
/**
 * Field descriptor flattened from either legacy rows (1 → 4) or labels (18 → input/select). `wrapId` and
 * `input.id` carry the numeric component ids the submit must echo.
 */
type Field =
  | { kind: "text"; label?: string; description?: string; input: Component; legacy: boolean; wrapId: number }
  | { kind: "select"; label?: string; description?: string; input: Component; legacy: boolean; wrapId: number }
  | { kind: "display"; content: string };

/** Discord numbers components depth-first from 1 when the author gave no ids; JDA reads them back. */
function assignIds(components: Component[]): Component[] {
  let next = 1;
  const visit = (c: Component): Component => {
    const id = c.id ?? next;
    next = Math.max(next, id) + 1;
    const out: Component = { ...c, id };
    if (c.component) out.component = visit(c.component);
    if (c.components) out.components = c.components.map(visit);
    return out;
  };
  return components.map(visit);
}

function flatten(raw: Component[]): Field[] {
  const out: Field[] = [];
  for (const c of assignIds(raw)) {
    const wrapId = c.id ?? 0;
    if (c.type === ComponentType.TextDisplay) {
      out.push({ kind: "display", content: c.content ?? "" });
      continue;
    }
    if (c.type === ComponentType.Label && c.component) {
      const input = c.component;
      const description = c.description ?? undefined;
      if (input.type === ComponentType.TextInput) out.push({ kind: "text", label: c.label, description, input, legacy: false, wrapId });
      else if (isSelect(input.type)) out.push({ kind: "select", label: c.label, description, input, legacy: false, wrapId });
      continue;
    }
    if (c.type !== ComponentType.ActionRow) continue;
    for (const inner of c.components ?? []) {
      if (inner.type === ComponentType.TextInput) out.push({ kind: "text", label: inner.label, input: inner, legacy: true, wrapId });
      else if (isSelect(inner.type)) out.push({ kind: "select", label: inner.placeholder, input: inner, legacy: true, wrapId });
    }
  }
  return out;
}

function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.kind === "display" || !f.input.custom_id) continue;
    if (f.kind === "text") v[f.input.custom_id] = [f.input.value ?? ""];
    else v[f.input.custom_id] = f.input.options?.filter((o) => o.default).map((o) => o.value) ?? f.input.default_values?.map((d) => d.id) ?? [];
  }
  return v;
}

function toSubmit(fields: Field[], values: Values): ModalSubmitComponent[] {
  const out: ModalSubmitComponent[] = [];
  for (const f of fields) {
    if (f.kind === "display" || !f.input.custom_id) continue;
    const id = f.input.custom_id;
    const val = values[id] ?? [];
    const inputId = f.input.id ?? 0;
    if (f.kind === "text" && f.legacy) {
      out.push({ type: 1, id: f.wrapId, components: [{ type: 4, id: inputId, custom_id: id, value: val[0] ?? "" }] });
      continue;
    }
    if (f.kind === "text") out.push({ type: 18, id: f.wrapId, component: { type: 4, id: inputId, custom_id: id, value: val[0] ?? "" } });
    else out.push({ type: 18, id: f.wrapId, component: { type: f.input.type, id: inputId, custom_id: id, values: val } });
  }
  return out;
}

function validate(fields: Field[], values: Values): string | null {
  for (const f of fields) {
    if (f.kind === "display" || !f.input.custom_id) continue;
    const v = values[f.input.custom_id] ?? [];
    const name = f.label ?? f.input.custom_id;
    const required = f.input.required !== false;
    if (f.kind === "text") {
      const text = v[0] ?? "";
      if (required && !text.trim()) return `${name} is required.`;
      if (text && f.input.min_length && text.length < f.input.min_length) return `${name} needs at least ${f.input.min_length} characters.`;
      continue;
    }
    if (required && v.length < Math.max(1, f.input.min_values ?? 1)) return `Choose ${name}.`;
  }
  return null;
}

function TextField({ f, value, onChange, autoFocus }: { f: Extract<Field, { kind: "text" }>; value: string; onChange: (v: string) => void; autoFocus: boolean }) {
  const c = f.input;
  const common = {
    id: `m-${c.custom_id}`,
    className: classes.input,
    value,
    placeholder: c.placeholder,
    maxLength: c.max_length,
    autoFocus,
    onChange: (e: { currentTarget: { value: string } }) => onChange(e.currentTarget.value),
  };
  return (
    <div className={classes.field}>
      <label htmlFor={common.id} className={classes.label}>
        {f.label}
        {c.required !== false && <span className={classes.req}>*</span>}
      </label>
      {f.description && <div className={classes.desc}>{f.description}</div>}
      {c.style === 2 ? <textarea {...common} rows={5} /> : <input {...common} type="text" />}
      {c.max_length && c.style === 2 ? (
        <div className={classes.counter}>
          {value.length}/{c.max_length}
        </div>
      ) : null}
    </div>
  );
}

function ModalForm({ open }: { open: OpenModal }) {
  const conn = usePlayConnection();
  const fields = flatten(open.modal.components);
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const result = usePlay((s) => (nonce ? s.results[nonce] : undefined));
  const submitting = nonce !== null && result === undefined;

  const close = () => conn.actions.closeModal(open.interactionId);
  const set = (id: string, v: string[]) => setValues((prev) => ({ ...prev, [id]: v }));

  // The bot took the submission: close. It refused: keep the form so nothing typed is lost.
  useEffect(() => {
    if (result === undefined) return;
    if (result === null) return conn.actions.closeModal(open.interactionId);
    setError(result);
    setNonce(null);
  }, [result, conn, open.interactionId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(fields, values);
    setError(problem);
    if (problem) return;
    setNonce(conn.submitModal(open.interactionId, open.modal.custom_id, toSubmit(fields, values), open.channelId));
  };

  let firstInput = true;
  return (
    <form onSubmit={submit} className={classes.form}>
      <div className={classes.body}>
        {fields.map((f, i) => {
          if (f.kind === "display") return <Markdown key={i} content={f.content} className={classes.display} />;
          const id = f.input.custom_id ?? String(i);
          if (f.kind === "text") {
            const auto = firstInput;
            firstInput = false;
            return <TextField key={id} f={f} value={values[id]?.[0] ?? ""} onChange={(v) => set(id, [v])} autoFocus={auto} />;
          }
          return (
            <div key={id} className={classes.field}>
              {f.label && <div className={classes.label}>{f.label}</div>}
              {f.description && <div className={classes.desc}>{f.description}</div>}
              <SelectControl component={f.input} channelId={open.channelId} value={values[id] ?? []} onChange={(v) => set(id, v)} />
            </div>
          );
        })}
        {error && <div className={classes.error}>{error}</div>}
      </div>
      <div className={classes.footer}>
        <button type="button" className={classes.cancel} onClick={close}>
          Cancel
        </button>
        <button type="submit" className={classes.submit} disabled={submitting} data-busy={submitting || undefined}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

/** Shows the bot's modal dialogs (one at a time, newest last) and submits them as `modal_submit`. */
export function ModalHost() {
  const modals = usePlay((s) => s.modals);
  const conn = usePlayConnection();
  const top = modals[modals.length - 1];
  return (
    <Modal
      opened={!!top}
      onClose={() => top && conn.actions.closeModal(top.interactionId)}
      title={top?.modal.title}
      centered
      size="lg"
      classNames={{ content: "ti4play", body: classes.modalBody }}
      zIndex="var(--z-settings-modal)"
    >
      {top && <ModalForm key={top.interactionId} open={top} />}
    </Modal>
  );
}

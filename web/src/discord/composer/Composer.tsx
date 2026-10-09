import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconSend, IconSlash, IconX } from "@tabler/icons-react";
import type { Snowflake } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import { displayName } from "../client/hooks";
import { flattenCommands, searchCommands, type CommandLeaf } from "./commands";
import { CommandForm } from "./CommandForm";
import classes from "./Composer.module.css";

type Props = {
  channelId: Snowflake;
  placeholder?: string;
};

/** Chat box with a `/` command palette. Plain text sends as the player; commands open a typed form. */
export function Composer({ channelId, placeholder }: Props) {
  const conn = usePlayConnection();
  const commands = usePlay((s) => s.commands);
  const channelName = usePlay((s) => s.channels[channelId]?.name);
  const status = usePlay((s) => s.status);
  const replyTo = usePlay((s) => s.replyTo[channelId] ?? null);
  const leaves = useMemo(() => flattenCommands(commands), [commands]);
  const [text, setText] = useState("");
  const [leaf, setLeaf] = useState<CommandLeaf | null>(null);
  const [active, setActive] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const slash = !leaf && text.startsWith("/") && !text.includes("\n");
  const suggestions = useMemo(() => (slash ? searchCommands(leaves, text.slice(1)) : []), [slash, leaves, text]);

  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    setLeaf(null);
    setText("");
  }, [channelId]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const resize = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  useEffect(resize, [text]);
  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);

  const choose = (l: CommandLeaf) => {
    setLeaf(l);
    setText("");
  };

  const send = () => {
    const content = text.trim();
    if (!content) return;
    if (!conn.sendMessage(channelId, content, replyTo?.id)) return;
    setText("");
    if (replyTo) conn.actions.setReply(channelId, null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash && suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return setActive((a) => (a + 1) % suggestions.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return choose(suggestions[active]);
      }
      if (e.key === "Escape") return setText("");
    }
    if (e.key === "Escape" && replyTo) return conn.actions.setReply(channelId, null);
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const done = () => {
    setLeaf(null);
    window.setTimeout(() => area.current?.focus(), 0);
  };

  if (leaf) {
    return (
      <div className={`ti4play ${classes.composer}`}>
        <CommandForm channelId={channelId} leaf={leaf} onCancel={done} onDone={done} />
      </div>
    );
  }

  return (
    <div className={`ti4play ${classes.composer}`}>
      {slash && (
        <div className={classes.palette} ref={list} role="listbox" aria-label="Slash commands">
          <div className={classes.paletteHead}>
            Commands <span className={classes.paletteCount}>{suggestions.length}</span>
          </div>
          {suggestions.length === 0 && <div className={classes.paletteEmpty}>No command matches “{text.slice(1)}”.</div>}
          {suggestions.map((l, i) => (
            <button
              type="button"
              key={l.key}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={classes.paletteItem}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(l)}
            >
              <span className={classes.palettePath}>
                <span className={classes.paletteRoot}>/{l.path[0]}</span>
                {l.path.slice(1).map((p) => (
                  <span key={p}> {p}</span>
                ))}
              </span>
              <span className={classes.paletteDesc}>{l.description}</span>
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className={classes.replyBar}>
          <span>
            Replying to <strong>{displayName(replyTo.author)}</strong>
          </span>
          <button type="button" className={classes.iconButton} onClick={() => conn.actions.setReply(channelId, null)} aria-label="Cancel reply">
            <IconX size={13} />
          </button>
        </div>
      )}
      <div className={classes.box} data-slash={slash || undefined} data-reply={replyTo ? true : undefined}>
        <IconSlash size={15} className={classes.slashIcon} aria-hidden />
        <textarea
          ref={area}
          className={classes.textarea}
          rows={1}
          value={text}
          placeholder={placeholder ?? (channelName ? `Message #${channelName} — type / for commands` : "Type / for commands")}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          disabled={status !== "open"}
          aria-label="Message"
        />
        <button type="button" className={classes.sendButton} onClick={send} disabled={!text.trim() || slash} aria-label="Send">
          <IconSend size={15} />
        </button>
      </div>
    </div>
  );
}

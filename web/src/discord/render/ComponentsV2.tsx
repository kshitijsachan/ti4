import type { CSSProperties, ReactNode } from "react";
import type { Component } from "../types";
import { ComponentType } from "../types";
import { ActionRow, DiscordButton, isSelect, ComponentRows, useMessageTarget } from "./Components";
import { Markdown } from "./Markdown";
import { FileCard, ZoomImage, resolveMediaUrl } from "./Media";
import { colorToCss } from "./Embed";
import classes from "./ComponentsV2.module.css";

/** Renders an `IS_COMPONENTS_V2` message body: layout components replace content and embeds. */
export function ComponentsV2({ components }: { components: Component[] }) {
  return <div className={classes.stack}>{components.map((c, i) => <V2Node key={c.id ?? i} c={c} />)}</div>;
}

function V2Node({ c }: { c: Component }): ReactNode {
  switch (c.type) {
    case ComponentType.ActionRow:
      return <ActionRow row={c} />;
    case ComponentType.Button:
      return <DiscordButton c={c} />;
    case ComponentType.TextDisplay:
      return <Markdown content={c.content ?? ""} />;
    case ComponentType.Section:
      return <Section c={c} />;
    case ComponentType.Thumbnail:
      return <Thumb c={c} />;
    case ComponentType.MediaGallery:
      return <Gallery c={c} />;
    case ComponentType.File:
      return <V2File c={c} />;
    case ComponentType.Separator:
      return <div className={c.divider === false ? classes.spacer : classes.divider} data-large={c.spacing === 2 || undefined} />;
    case ComponentType.Container:
      return <Container c={c} />;
    default:
      if (isSelect(c.type)) return <ComponentRows rows={[c]} />;
      return null;
  }
}

function Container({ c }: { c: Component }) {
  const color = colorToCss(c.accent_color);
  const style = color ? ({ "--accent": color } as CSSProperties) : undefined;
  return (
    <div className={classes.container} style={style} data-accent={color ? true : undefined} data-spoiler={c.spoiler || undefined}>
      {(c.components ?? []).map((x, i) => (
        <V2Node key={x.id ?? i} c={x} />
      ))}
    </div>
  );
}

function Section({ c }: { c: Component }) {
  return (
    <div className={classes.section}>
      <div className={classes.sectionText}>
        {(c.components ?? []).map((x, i) => (
          <V2Node key={x.id ?? i} c={x} />
        ))}
      </div>
      {c.accessory && (
        <div className={classes.accessory}>
          <V2Node c={c.accessory} />
        </div>
      )}
    </div>
  );
}

function Thumb({ c }: { c: Component }) {
  const { attachments } = useMessageTarget();
  if (!c.media?.url) return null;
  return (
    <ZoomImage
      src={resolveMediaUrl(c.media.url, attachments)}
      alt={c.description ?? "thumbnail"}
      width={c.media.width}
      height={c.media.height}
      maxWidth={88}
      maxHeight={88}
    />
  );
}

function Gallery({ c }: { c: Component }) {
  const { attachments } = useMessageTarget();
  const items = c.items ?? [];
  const single = items.length === 1;
  return (
    <div className={single ? classes.gallerySingle : classes.gallery}>
      {items.map((it, i) => (
        <ZoomImage
          key={i}
          src={resolveMediaUrl(it.media.url, attachments)}
          alt={it.description ?? `image ${i + 1}`}
          width={it.media.width}
          height={it.media.height}
          maxWidth={single ? 520 : 240}
          maxHeight={single ? 400 : 200}
        />
      ))}
    </div>
  );
}

function V2File({ c }: { c: Component }) {
  const { attachments } = useMessageTarget();
  if (!c.file?.url) return null;
  const url = resolveMediaUrl(c.file.url, attachments);
  const att = attachments.find((a) => a.url === url);
  return <FileCard name={att?.filename ?? c.file.url.replace(/^attachment:\/\//, "")} url={url} size={att?.size} />;
}

import type { CSSProperties } from "react";
import type { Embed as EmbedT } from "../types";
import { Markdown } from "./Markdown";
import { ZoomImage } from "./Media";
import classes from "./Embed.module.css";

export function colorToCss(color: number | null | undefined): string | undefined {
  if (color === null || color === undefined || color === 0) return undefined;
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Inline fields pack up to three per row, as Discord does; a non-inline field takes the whole row. */
function fieldRows(fields: NonNullable<EmbedT["fields"]>) {
  const rows: (typeof fields)[] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (f.inline && last && last.length < 3 && last.every((x) => x.inline)) last.push(f);
    else rows.push([f]);
  }
  return rows;
}

/**
 * A rich embed. The embed's colour is keyed as a short band notched into the top edge (the same device as
 * the player-card identity band) rather than Discord's thick left stripe.
 */
export function Embed({ embed }: { embed: EmbedT }) {
  const color = colorToCss(embed.color);
  const style = color ? ({ "--embed-color": color } as CSSProperties) : undefined;
  const title = embed.title ? (
    embed.url ? (
      <a className={classes.titleLink} href={embed.url} target="_blank" rel="noreferrer noopener">
        <Markdown inline content={embed.title} />
      </a>
    ) : (
      <Markdown inline content={embed.title} />
    )
  ) : null;
  return (
    <div className={classes.embed} style={style} data-colored={color ? true : undefined}>
      <div className={classes.main}>
        <div className={classes.body}>
          {embed.author && (
            <div className={classes.author}>
              {embed.author.icon_url && <img className={classes.authorIcon} src={embed.author.icon_url} alt="" />}
              {embed.author.url ? (
                <a href={embed.author.url} target="_blank" rel="noreferrer noopener">
                  {embed.author.name}
                </a>
              ) : (
                embed.author.name
              )}
            </div>
          )}
          {title && <div className={classes.title}>{title}</div>}
          {embed.description && <Markdown content={embed.description} className={classes.description} />}
          {embed.fields && embed.fields.length > 0 && (
            <div className={classes.fields}>
              {fieldRows(embed.fields).map((row, i) => (
                <div key={i} className={classes.fieldRow} style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                  {row.map((f, j) => (
                    <div key={j} className={classes.field}>
                      <div className={classes.fieldName}>
                        <Markdown inline content={f.name} />
                      </div>
                      <Markdown content={f.value} className={classes.fieldValue} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {embed.thumbnail?.url && (
          <ZoomImage
            className={classes.thumb}
            src={embed.thumbnail.url}
            alt="thumbnail"
            width={embed.thumbnail.width}
            height={embed.thumbnail.height}
            maxWidth={80}
            maxHeight={80}
          />
        )}
      </div>
      {embed.image?.url && (
        <div className={classes.image}>
          <ZoomImage src={embed.image.url} alt={embed.title ?? "image"} width={embed.image.width} height={embed.image.height} maxWidth={480} />
        </div>
      )}
      {(embed.footer || embed.timestamp) && (
        <div className={classes.footer}>
          {embed.footer?.icon_url && <img className={classes.footerIcon} src={embed.footer.icon_url} alt="" />}
          {embed.footer?.text && <span>{embed.footer.text}</span>}
          {embed.footer?.text && embed.timestamp && <span className={classes.dot}>·</span>}
          {embed.timestamp && <span className={classes.mono}>{new Date(embed.timestamp).toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

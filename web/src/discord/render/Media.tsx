import { useState } from "react";
import { Modal } from "@mantine/core";
import { IconDownload, IconFile, IconPhotoOff } from "@tabler/icons-react";
import type { Attachment } from "../types";
import classes from "./Media.module.css";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i;

export function isImage(name: string, contentType?: string): boolean {
  if (contentType?.startsWith("image/")) return true;
  return IMAGE_EXT.test(name);
}

/** Resolve a component media url; `attachment://name` points at one of the message's own files. */
export function resolveMediaUrl(url: string, attachments: Attachment[]): string {
  if (!url.startsWith("attachment://")) return url;
  const name = url.slice("attachment://".length);
  return attachments.find((a) => a.filename === name)?.url ?? url;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type ImageProps = {
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  maxWidth?: number;
  maxHeight?: number;
  className?: string;
};

/**
 * Inline image with its box reserved up front (so a late load never shoves the log), opening a lightbox
 * on click.
 */
export function ZoomImage({ src, alt, width, height, maxWidth = 520, maxHeight = 380, className }: ImageProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a className={classes.brokenImage} href={src} target="_blank" rel="noreferrer noopener">
        <IconPhotoOff size={14} /> {alt}
      </a>
    );
  }
  let w = width ?? undefined;
  let h = height ?? undefined;
  if (w && h) {
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return (
    <>
      <button
        type="button"
        className={`${classes.imageButton} ${className ?? ""}`}
        style={w && h ? { width: w, aspectRatio: `${width} / ${height}` } : { maxWidth, maxHeight }}
        onClick={() => setOpen(true)}
        aria-label={`Open ${alt}`}
      >
        <img src={src} alt={alt} loading="lazy" decoding="async" className={classes.image} style={w && h ? undefined : { maxWidth, maxHeight }} onError={() => setFailed(true)} />
      </button>
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <Modal
      opened
      onClose={onClose}
      withCloseButton={false}
      centered
      size="auto"
      padding={0}
      classNames={{ content: `ti4play ${classes.lightbox}`, body: classes.lightboxBody }}
      overlayProps={{ backgroundOpacity: 0.85, blur: 2 }}
    >
      <button type="button" className={classes.lightboxClose} onClick={onClose} aria-label="Close">
        <img src={src} alt={alt} className={classes.lightboxImage} />
      </button>
      <div className={classes.lightboxBar}>
        <span className={classes.lightboxName}>{alt}</span>
        <a href={src} target="_blank" rel="noreferrer noopener" className={classes.lightboxLink}>
          Open original
        </a>
      </div>
    </Modal>
  );
}

export function FileCard({ name, url, size }: { name: string; url: string; size?: number }) {
  return (
    <a className={classes.file} href={url} target="_blank" rel="noreferrer noopener" download={name}>
      <IconFile size={22} className={classes.fileIcon} />
      <span className={classes.fileText}>
        <span className={classes.fileName}>{name}</span>
        {size ? <span className={classes.fileSize}>{formatSize(size)}</span> : null}
      </span>
      <IconDownload size={16} className={classes.fileDl} />
    </a>
  );
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className={classes.attachments}>
      {attachments.map((a) =>
        isImage(a.filename, a.content_type) ? (
          <ZoomImage key={a.id} src={a.url} alt={a.description || a.filename} width={a.width} height={a.height} />
        ) : (
          <FileCard key={a.id} name={a.filename} url={a.url} size={a.size} />
        ),
      )}
    </div>
  );
}

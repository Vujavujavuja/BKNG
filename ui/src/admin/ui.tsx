import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type DragEvent, type ReactNode } from "react";
import { api, assetUrl, BASE } from "../lib/api";

// ---- Toasts ----

interface Toast {
  id: number;
  text: string;
  bad: boolean;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
const emit = () => toastListeners.forEach((l) => l());

export function toast(text: string, bad = false) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, bad }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, bad ? 7000 : 3000);
}

export const toastError = (error: unknown) => toast(error instanceof Error ? error.message : "Something went wrong.", true);

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="ad-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`ad-toast ${t.bad ? "is-bad" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---- Data loading ----

export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    return api<T>(path)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

/** Tracks an edited copy of saved data and whether it differs. */
export function useDraft<T>(saved: T | null) {
  const [draft, setDraft] = useState<T | null>(saved);
  const savedJson = useMemo(() => JSON.stringify(saved), [saved]);
  useEffect(() => {
    if (saved !== null) setDraft(saved);
  }, [saved]);
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== savedJson;
  return { draft, setDraft: setDraft as (value: T) => void, dirty };
}

// ---- Controls ----

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "danger" | "ghost"; small?: boolean; busy?: boolean }) {
  const { variant, small, busy, className, children, disabled, ...rest } = props;
  return (
    <button type="button" {...rest} disabled={disabled || busy} className={`ad-btn ${variant ? `is-${variant}` : ""} ${small ? "is-small" : ""} ${className ?? ""}`}>
      {busy ? "Working…" : children}
    </button>
  );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="ad-field">
      <span className="ad-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="ad-hint">{props.hint}</span>}
    </label>
  );
}

export function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode }) {
  return (
    <label className="ad-toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="ad-toggle-track" />
      <span>{props.label}</span>
    </label>
  );
}

export function NumberField(props: { label: string; hint?: ReactNode; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <input type="number" value={props.value} min={props.min} max={props.max} step={props.step} onChange={(e) => props.onChange(Number(e.target.value))} />
    </Field>
  );
}

export function ColorField(props: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <div className="ad-field">
      <span className="ad-label">{props.label}</span>
      <div className="ad-color">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(props.value) ? props.value : "#000000"} onChange={(e) => props.onChange(e.target.value)} aria-label={`${props.label} picker`} />
        <input
          type="text"
          value={text}
          aria-label={`${props.label} hex value`}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) props.onChange(e.target.value);
          }}
        />
      </div>
    </div>
  );
}

/** Shrinks large photos in the browser so uploads stay well under the storage limit. */
async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/svg+xml" || file.type === "image/gif" || file.size < 400_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" && file.size < 1_400_000 ? "image/png" : "image/jpeg";
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), type, 0.85));
}

export function ImageDrop(props: { label: string; assetId: string; onChange: (assetId: string) => void; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image file.", true);
    setBusy(true);
    try {
      const blob = await prepareImage(file);
      const res = await fetch(`${BASE}/api/admin/assets`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": blob.type, "X-Requested-With": "bkng" },
        body: blob,
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "The image could not be uploaded.");
      props.onChange(data.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files[0]);
  };

  return (
    <div className="ad-field">
      <span className="ad-label">{props.label}</span>
      <div
        className={`ad-drop ${over ? "is-over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {props.assetId && <img src={assetUrl(props.assetId)} alt="" />}
        <span className="ad-muted">{busy ? "Uploading…" : props.assetId ? "Drop a new image to replace it" : "Drop an image here, or click to choose one"}</span>
        <span className="ad-spacer" />
        {props.assetId && (
          <Button
            variant="ghost"
            small
            onClick={(e) => {
              e.stopPropagation();
              props.onChange("");
            }}
          >
            Remove
          </Button>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      {props.hint && <span className="ad-hint">{props.hint}</span>}
    </div>
  );
}

const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    {[3, 7, 11].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
  </svg>
);

/** A list reordered by dragging the handle, or with the arrow buttons for keyboard and touch. */
export function Sortable<T>(props: { items: T[]; keyOf: (item: T) => string; onChange: (items: T[]) => void; render: (item: T, index: number) => ReactNode }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= props.items.length || from === to) return;
    const next = [...props.items];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    props.onChange(next);
  };
  return (
    <div className="ad-list">
      {props.items.map((item, index) => (
        <div
          key={props.keyOf(item)}
          className={`ad-item ${dragging === index ? "is-dragging" : ""}`}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            if (dragging !== index) {
              move(dragging, index);
              setDragging(index);
            }
          }}
          onDrop={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="ad-handle"
            draggable
            aria-label="Drag to reorder, or use arrow keys"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(index));
              setDragging(index);
            }}
            onDragEnd={() => setDragging(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") move(index, index - 1);
              if (e.key === "ArrowDown") move(index, index + 1);
            }}
          >
            <GripIcon />
          </button>
          <div className="ad-item-body">{props.render(item, index)}</div>
          <Button variant="ghost" small aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
            ↑
          </Button>
          <Button variant="ghost" small aria-label="Move down" disabled={index === props.items.length - 1} onClick={() => move(index, index + 1)}>
            ↓
          </Button>
        </div>
      ))}
    </div>
  );
}

export function Card(props: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="ad-card">
      {(props.title || props.actions) && (
        <div className="ad-card-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.description && <p>{props.description}</p>}
          </div>
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function PageHead(props: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="ad-head">
      <div>
        <h1>{props.title}</h1>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.actions && <div className="ad-row">{props.actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="ad-tabs" role="tablist">
      {props.tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={props.value === tab.id} className={`ad-tab ${props.value === tab.id ? "is-active" : ""}`} onClick={() => props.onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton(props: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      small
      onClick={() => {
        void navigator.clipboard.writeText(props.text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : (props.label ?? "Copy")}
    </Button>
  );
}

export function SaveBar(props: { dirty: boolean; busy: boolean; onSave: () => void; onReset?: () => void }) {
  if (!props.dirty) return null;
  return (
    <div className="ad-savebar">
      <span className="ad-muted">You have unsaved changes</span>
      {props.onReset && (
        <Button variant="secondary" onClick={props.onReset} disabled={props.busy}>
          Discard
        </Button>
      )}
      <Button onClick={props.onSave} busy={props.busy}>
        Save changes
      </Button>
    </div>
  );
}

export function Loading(props: { error?: string }) {
  return <div className="ad-empty">{props.error || "Loading…"}</div>;
}

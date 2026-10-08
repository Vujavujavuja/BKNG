import { useEffect, useRef, useState } from "react";
import { cleanFontName, DEFAULT_THEME, FONTS, mergeDeep, ROUND_MAX, type InfoBlockId, type Theme, type ThemeColors, type ThemeTexts } from "../../../shared/theme";
import type { EventType } from "../../../shared/types";
import { BASE, send } from "../lib/api";
import { Button, ColorField, Field, FontDrop, ImageDrop, Loading, PageHead, SaveBar, Sortable, Toggle, toast, toastError, useDraft, useLoad } from "./ui";

interface SettingsData {
  site: Theme;
  general: { businessName: string };
}

const PRESETS: { name: string; colors: Omit<ThemeColors, "date"> }[] = [
  { name: "Light", colors: DEFAULT_THEME.colors },
  { name: "Dark", colors: { background: "#0f1115", card: "#181b22", text: "#f1f3f7", muted: "#9aa3b2", primary: "#7c9cff", primaryText: "#0f1115", border: "#2a2f3a" } },
  { name: "Warm", colors: { background: "#f7f1e8", card: "#fffdf9", text: "#2b2118", muted: "#7d6c5b", primary: "#c2571a", primaryText: "#ffffff", border: "#eadfce" } },
  { name: "Forest", colors: { background: "#eef3ee", card: "#ffffff", text: "#16241b", muted: "#5d6f63", primary: "#1f7a4d", primaryText: "#ffffff", border: "#dbe5dc" } },
  { name: "Mono", colors: { background: "#ffffff", card: "#ffffff", text: "#111111", muted: "#6b6b6b", primary: "#111111", primaryText: "#ffffff", border: "#dcdcdc" } },
];

const COLOR_LABELS: Record<Exclude<keyof ThemeColors, "date">, string> = {
  background: "Page background",
  card: "Card",
  text: "Text",
  muted: "Secondary text",
  primary: "Buttons and highlights",
  primaryText: "Text on buttons",
  border: "Lines and borders",
};

const TEXT_LABELS: Record<keyof ThemeTexts, string> = {
  landingTitle: "Home page title",
  landingSubtitle: "Home page subtitle",
  pickDate: "Date step heading",
  pickTime: "Time list heading",
  noSlots: "No times message",
  formTitle: "Form heading",
  nameLabel: "Name field",
  emailLabel: "Email field",
  nextLabel: "Continue button",
  backLabel: "Back button",
  submitLabel: "Confirm button",
  confirmTitle: "Confirmation heading",
  confirmMessage: "Confirmation message",
  addToCalendar: "Add to calendar",
  manageLabel: "Manage link",
  cancelLabel: "Cancel button",
  rescheduleLabel: "Reschedule button",
  cancelledTitle: "Cancelled heading",
};

const BLOCK_LABELS: Record<InfoBlockId, string> = {
  logo: "Logo",
  business: "Business name",
  title: "Meeting name",
  description: "Description",
  details: "Length, place and chosen time",
};

const roundLabel = (value: number, full: string) => (value >= ROUND_MAX ? full : `${value}px`);

function Roundness(props: { label: string; value: number; onChange: (value: number) => void; full?: string }) {
  return (
    <Field label={`${props.label}: ${roundLabel(props.value, props.full ?? "fully round")}`} hint="Slide all the way right for fully round.">
      <input type="range" min={0} max={ROUND_MAX} value={Math.min(props.value, ROUND_MAX)} onChange={(e) => props.onChange(Number(e.target.value))} />
    </Field>
  );
}

function FontPicker(props: { label: string; value: string; uploaded: string[]; onChange: (font: string) => void }) {
  const known = props.value === "system" || FONTS.includes(props.value) || props.uploaded.includes(props.value);
  const [other, setOther] = useState(!known);
  return (
    <div className="ad-stack" style={{ gap: 6 }}>
      <Field label={props.label}>
        <select
          value={other ? "__other" : props.value}
          onChange={(e) => {
            setOther(e.target.value === "__other");
            if (e.target.value !== "__other") props.onChange(e.target.value);
          }}
        >
          <option value="system">Device default</option>
          {props.uploaded.length > 0 && (
            <optgroup label="Your fonts">
              {props.uploaded.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Popular">
            {FONTS.filter((font) => font !== "system").map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </optgroup>
          <option value="__other">Another Google font…</option>
        </select>
      </Field>
      {other && (
        <Field label="Google font name" hint={<>Type the exact name from <a href="https://fonts.google.com" target="_blank" rel="noreferrer">fonts.google.com</a>, for example Bricolage Grotesque.</>}>
          <input type="text" value={props.value === "system" ? "" : props.value} onChange={(e) => props.onChange(cleanFontName(e.target.value) || "system")} />
        </Field>
      )}
    </div>
  );
}

export function Design() {
  const settings = useLoad<SettingsData>("/admin/settings");
  const events = useLoad<{ eventTypes: EventType[] }>("/admin/event-types");
  const { draft: theme, setDraft, dirty } = useDraft<Theme>(settings.data?.site ?? null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const ready = Boolean(settings.data && theme);

  // The desktop preview is drawn at full desktop width and scaled down to fit the panel.
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry!.contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [ready]);

  // The preview is the real booking page in a frame; it asks for the draft design when it loads,
  // and gets every later change as it happens.
  const latest = useRef<Theme | null>(null);
  latest.current = theme;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ bkngTheme: theme }, window.location.origin);
  }, [theme]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !e.data?.bkngReady) return;
      frame.current?.contentWindow?.postMessage({ bkngTheme: latest.current }, window.location.origin);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!theme || !settings.data) return <Loading error={settings.error} />;
  const set = (patch: Partial<Theme>) => setDraft({ ...theme, ...patch });
  const setColor = (key: keyof ThemeColors, value: string) => set({ colors: { ...theme.colors, [key]: value } });
  const setText = (key: keyof ThemeTexts, value: string) => set({ texts: { ...theme.texts, [key]: value } });

  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/site", theme);
      toast("Design saved");
      await settings.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const first = events.data?.eventTypes.find((e) => e.active);
  const uploadedFonts = theme.customFonts.map((f) => f.name).filter(Boolean);
  const frameWidth = device === "mobile" ? 390 : 1180;
  const frameHeight = device === "mobile" ? 760 : 820;
  const scale = stageWidth ? Math.min(1, stageWidth / frameWidth) : 1;

  return (
    <div className="ad-stack">
      <PageHead title="Design" description="Change anything on the left and see it on the right. Nothing goes live until you save." />
      <div className="ad-builder">
        <div className="ad-builder-panel">
          <details open>
            <summary>Logo</summary>
            <div className="ad-stack">
              <ImageDrop label="Logo" assetId={theme.logoAssetId} onChange={(logoAssetId) => set({ logoAssetId })} hint="PNG or SVG with a transparent background works best." />
              <Field label={`Logo height: ${theme.logoHeight}px`}>
                <input type="range" min={16} max={120} value={theme.logoHeight} onChange={(e) => set({ logoHeight: Number(e.target.value) })} />
              </Field>
            </div>
          </details>

          <details open>
            <summary>Colors</summary>
            <div className="ad-stack">
              <div>
                <div className="ad-label" style={{ marginBottom: 6 }}>
                  Start from a preset
                </div>
                <div className="ad-swatches">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="ad-swatch"
                      title={preset.name}
                      aria-label={`${preset.name} preset`}
                      style={{ background: `linear-gradient(135deg, ${preset.colors.background} 50%, ${preset.colors.primary} 50%)` }}
                      onClick={() => set({ colors: { ...preset.colors, date: "" } })}
                    />
                  ))}
                </div>
              </div>
              {(Object.keys(COLOR_LABELS) as (keyof typeof COLOR_LABELS)[]).map((key) => (
                <ColorField key={key} label={COLOR_LABELS[key]} value={theme.colors[key]} onChange={(value) => setColor(key, value)} />
              ))}
            </div>
          </details>

          <details>
            <summary>Background image</summary>
            <div className="ad-stack">
              <ImageDrop label="Image behind the booking card" assetId={theme.backgroundAssetId} onChange={(backgroundAssetId) => set({ backgroundAssetId })} />
              <Field label={`Tint with the page background color: ${theme.backgroundOverlay}%`} hint="Raise this if the image makes the page hard to read.">
                <input type="range" min={0} max={95} value={theme.backgroundOverlay} onChange={(e) => set({ backgroundOverlay: Number(e.target.value) })} />
              </Field>
            </div>
          </details>

          <details>
            <summary>Fonts</summary>
            <div className="ad-stack">
              <FontPicker label="Text font" value={theme.font} uploaded={uploadedFonts} onChange={(font) => set({ font })} />
              <FontPicker label="Heading font" value={theme.headingFont} uploaded={uploadedFonts} onChange={(headingFont) => set({ headingFont })} />
              <Field label={`Text size: ${theme.fontSize}px`}>
                <input type="range" min={13} max={19} value={theme.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
              </Field>
              <div>
                <div className="ad-label" style={{ marginBottom: 6 }}>
                  Upload your own font
                </div>
                <div className="ad-stack" style={{ gap: 8 }}>
                  {theme.customFonts.map((font, i) => (
                    <div key={font.assetId} className="ad-row" style={{ flexWrap: "nowrap" }}>
                      <input
                        type="text"
                        value={font.name}
                        aria-label="Font name"
                        onChange={(e) => {
                          const name = e.target.value.replace(/[^A-Za-z0-9 _-]/g, "");
                          set({
                            customFonts: theme.customFonts.map((f, j) => (j === i ? { ...f, name } : f)),
                            font: theme.font === font.name ? name : theme.font,
                            headingFont: theme.headingFont === font.name ? name : theme.headingFont,
                          });
                        }}
                      />
                      <Button
                        variant="ghost"
                        small
                        onClick={() =>
                          set({
                            customFonts: theme.customFonts.filter((_, j) => j !== i),
                            font: theme.font === font.name ? "system" : theme.font,
                            headingFont: theme.headingFont === font.name ? "system" : theme.headingFont,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <FontDrop onAdd={(font) => set({ customFonts: [...theme.customFonts, font], font: font.name })} />
                  <span className="ad-hint">WOFF2, WOFF, TTF or OTF, up to 1.5 MB. Only upload fonts you have a licence to use on a website.</span>
                </div>
              </div>
            </div>
          </details>

          <details>
            <summary>Buttons</summary>
            <div className="ad-stack">
              <Field label="Style">
                <select value={theme.buttonStyle} onChange={(e) => set({ buttonStyle: e.target.value as Theme["buttonStyle"] })}>
                  <option value="filled">Filled</option>
                  <option value="outline">Outline</option>
                  <option value="soft">Soft tint</option>
                </select>
              </Field>
              <Field label="Size">
                <select value={theme.buttonSize} onChange={(e) => set({ buttonSize: e.target.value as Theme["buttonSize"] })}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </Field>
              <Roundness label="Corner roundness" value={theme.buttonRadius} onChange={(buttonRadius) => set({ buttonRadius })} full="pill" />
            </div>
          </details>

          <details>
            <summary>Calendar dates and times</summary>
            <div className="ad-stack">
              <Field label="Available dates look">
                <select value={theme.dayStyle} onChange={(e) => set({ dayStyle: e.target.value as Theme["dayStyle"] })}>
                  <option value="soft">Soft tint</option>
                  <option value="outline">Outline</option>
                  <option value="plain">Plain number</option>
                </select>
              </Field>
              <Roundness label="Date shape" value={theme.dayRadius} onChange={(dayRadius) => set({ dayRadius })} full="circle" />
              <Roundness label="Time button shape" value={theme.timeRadius} onChange={(timeRadius) => set({ timeRadius })} full="pill" />
              <Toggle checked={!theme.colors.date} onChange={(same) => set({ colors: { ...theme.colors, date: same ? "" : theme.colors.primary } })} label="Dates and times use the button color" />
              {theme.colors.date && <ColorField label="Dates and times color" value={theme.colors.date} onChange={(date) => set({ colors: { ...theme.colors, date } })} />}
            </div>
          </details>

          <details>
            <summary>Card, fields and lines</summary>
            <div className="ad-stack">
              <Field label={`Card corner roundness: ${theme.radius}px`}>
                <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
              </Field>
              <Roundness label="Form field roundness" value={theme.inputRadius} onChange={(inputRadius) => set({ inputRadius })} />
              <Field label={`Line thickness: ${theme.borderWidth}px`} hint="Borders around the card, fields and buttons. 0 removes them.">
                <input type="range" min={0} max={3} value={theme.borderWidth} onChange={(e) => set({ borderWidth: Number(e.target.value) })} />
              </Field>
              <Field label={`Card width: ${theme.cardWidth}px`}>
                <input type="range" min={560} max={1100} step={20} value={theme.cardWidth} onChange={(e) => set({ cardWidth: Number(e.target.value) })} />
              </Field>
              <Toggle checked={theme.shadow} onChange={(shadow) => set({ shadow })} label="Shadow under the card" />
            </div>
          </details>

          <details>
            <summary>Layout and order</summary>
            <div className="ad-stack">
              <Field label="Card layout">
                <select value={theme.layout} onChange={(e) => set({ layout: e.target.value as Theme["layout"] })}>
                  <option value="split">Details beside the calendar</option>
                  <option value="stacked">Details above the calendar</option>
                </select>
              </Field>
              <div>
                <div className="ad-label" style={{ marginBottom: 6 }}>
                  Steps (drag to reorder)
                </div>
                <Sortable
                  items={theme.stepOrder === "time-first" ? ["time", "form"] : ["form", "time"]}
                  keyOf={(step) => step}
                  onChange={(steps) => set({ stepOrder: steps[0] === "time" ? "time-first" : "form-first" })}
                  render={(step) => (step === "time" ? "Pick a date and time" : "Fill in the form")}
                />
              </div>
              <div>
                <div className="ad-label" style={{ marginBottom: 6 }}>
                  Details panel (drag to reorder, switch off to hide)
                </div>
                <Sortable
                  items={theme.infoBlocks}
                  keyOf={(block) => block.id}
                  onChange={(infoBlocks) => set({ infoBlocks })}
                  render={(block, i) => (
                    <Toggle
                      checked={block.visible}
                      onChange={(visible) => set({ infoBlocks: theme.infoBlocks.map((b, j) => (j === i ? { ...b, visible } : b)) })}
                      label={BLOCK_LABELS[block.id]}
                    />
                  )}
                />
              </div>
              <div className="ad-grid-2">
                <Field label="Clock">
                  <select value={theme.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as Theme["timeFormat"] })}>
                    <option value="24h">24-hour (14:30)</option>
                    <option value="12h">12-hour (2:30 PM)</option>
                  </select>
                </Field>
                <Field label="Week starts on">
                  <select value={theme.weekStart} onChange={(e) => set({ weekStart: Number(e.target.value) as 0 | 1 })}>
                    <option value={1}>Monday</option>
                    <option value={0}>Sunday</option>
                  </select>
                </Field>
              </div>
            </div>
          </details>

          <details>
            <summary>Wording</summary>
            <div className="ad-stack">
              {(Object.keys(TEXT_LABELS) as (keyof ThemeTexts)[]).map((key) => (
                <Field key={key} label={TEXT_LABELS[key]}>
                  <input type="text" value={theme.texts[key]} onChange={(e) => setText(key, e.target.value)} />
                </Field>
              ))}
            </div>
          </details>

          <details>
            <summary>Advanced</summary>
            <div className="ad-stack">
              <Toggle checked={theme.hideBranding} onChange={(hideBranding) => set({ hideBranding })} label='Hide "Powered by BKNG"' />
              <Field label="Custom CSS" hint="Optional, for anything the controls above don't cover. Elements use class names starting with bk-.">
                <textarea style={{ fontFamily: "ui-monospace, Menlo, monospace", minHeight: 120 }} value={theme.customCss} spellCheck={false} onChange={(e) => set({ customCss: e.target.value })} />
              </Field>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (window.confirm("Reset the whole design to the defaults? Your logo and images are kept until you save.")) setDraft(mergeDeep(DEFAULT_THEME, {}));
                  }}
                >
                  Reset to defaults
                </Button>
              </div>
            </div>
          </details>
        </div>

        <div className="ad-preview">
          <div className="ad-preview-bar">
            <strong>Preview</strong>
            <span className="ad-spacer" />
            <Button variant={device === "desktop" ? undefined : "secondary"} small onClick={() => setDevice("desktop")}>
              Desktop
            </Button>
            <Button variant={device === "mobile" ? undefined : "secondary"} small onClick={() => setDevice("mobile")}>
              Phone
            </Button>
            <Button variant="ghost" small onClick={() => setPreviewKey((k) => k + 1)}>
              Start over
            </Button>
          </div>
          <div className="ad-preview-stage" ref={stage} style={{ height: frameHeight * scale }}>
            <iframe
              key={previewKey}
              ref={frame}
              title="Booking page preview"
              src={`${BASE}/${first?.slug ?? ""}?preview=1`}
              style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})` }}
            />
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={() => setDraft(settings.data!.site)} />
    </div>
  );
}

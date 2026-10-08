export type InfoBlockId = "logo" | "business" | "title" | "description" | "details";

export interface ThemeColors {
  background: string;
  card: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  border: string;
  /** Available and selected dates and times. Empty means "same as primary". */
  date: string;
}

export interface CustomFont {
  name: string;
  assetId: string;
}

/** Roundness sliders stop here; this value and above means fully round (pill or circle). */
export const ROUND_MAX = 32;

export interface ThemeTexts {
  landingTitle: string;
  landingSubtitle: string;
  pickDate: string;
  pickTime: string;
  noSlots: string;
  formTitle: string;
  nameLabel: string;
  emailLabel: string;
  nextLabel: string;
  backLabel: string;
  submitLabel: string;
  confirmTitle: string;
  confirmMessage: string;
  addToCalendar: string;
  manageLabel: string;
  cancelLabel: string;
  rescheduleLabel: string;
  cancelledTitle: string;
}

export interface Theme {
  logoAssetId: string;
  logoHeight: number;
  colors: ThemeColors;
  backgroundAssetId: string;
  /** 0-100: how strongly the background color covers the background image. */
  backgroundOverlay: number;
  /** "system", a Google Fonts family name, or the name of an uploaded font. */
  font: string;
  headingFont: string;
  customFonts: CustomFont[];
  fontSize: number;
  radius: number;
  buttonStyle: "filled" | "outline" | "soft";
  buttonSize: "small" | "medium" | "large";
  buttonRadius: number;
  dayStyle: "soft" | "outline" | "plain";
  dayRadius: number;
  timeRadius: number;
  inputRadius: number;
  borderWidth: number;
  shadow: boolean;
  cardWidth: number;
  layout: "split" | "stacked";
  stepOrder: "time-first" | "form-first";
  infoBlocks: { id: InfoBlockId; visible: boolean }[];
  timeFormat: "12h" | "24h";
  weekStart: 0 | 1;
  texts: ThemeTexts;
  customCss: string;
  hideBranding: boolean;
}

export const DEFAULT_THEME: Theme = {
  logoAssetId: "",
  logoHeight: 40,
  colors: {
    background: "#f4f5f7",
    card: "#ffffff",
    text: "#14171f",
    muted: "#667085",
    primary: "#2f5bea",
    primaryText: "#ffffff",
    border: "#e3e6ec",
    date: "",
  },
  backgroundAssetId: "",
  backgroundOverlay: 0,
  font: "system",
  headingFont: "system",
  customFonts: [],
  fontSize: 15,
  radius: 12,
  buttonStyle: "filled",
  buttonSize: "medium",
  buttonRadius: 7,
  dayStyle: "soft",
  dayRadius: 7,
  timeRadius: 7,
  inputRadius: 7,
  borderWidth: 1,
  shadow: true,
  cardWidth: 880,
  layout: "split",
  stepOrder: "time-first",
  infoBlocks: [
    { id: "logo", visible: true },
    { id: "business", visible: true },
    { id: "title", visible: true },
    { id: "description", visible: true },
    { id: "details", visible: true },
  ],
  timeFormat: "24h",
  weekStart: 1,
  texts: {
    landingTitle: "Book a call",
    landingSubtitle: "Pick the kind of meeting you need.",
    pickDate: "Select a date",
    pickTime: "Select a time",
    noSlots: "No times available on this day.",
    formTitle: "Your details",
    nameLabel: "Name",
    emailLabel: "Email",
    nextLabel: "Continue",
    backLabel: "Back",
    submitLabel: "Confirm booking",
    confirmTitle: "You're booked",
    confirmMessage: "A confirmation with a calendar invite is on its way to your inbox.",
    addToCalendar: "Add to calendar",
    manageLabel: "Reschedule or cancel",
    cancelLabel: "Cancel booking",
    rescheduleLabel: "Reschedule",
    cancelledTitle: "This booking was cancelled",
  },
  customCss: "",
  hideBranding: false,
};

export const FONTS = [
  "system",
  "Inter",
  "DM Sans",
  "Manrope",
  "Poppins",
  "Work Sans",
  "IBM Plex Sans",
  "Space Grotesk",
  "Lora",
  "Playfair Display",
  "Fraunces",
  "JetBrains Mono",
];

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Font names end up inside CSS and URLs, so keep them to plain characters. */
export const cleanFontName = (name: string) => name.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 60);

export function fontStack(font: string): string {
  const name = cleanFontName(font);
  return !name || name === "system" ? SYSTEM_STACK : `"${name}", ${SYSTEM_STACK}`;
}

/** Google Fonts stylesheet for the fonts a theme uses, or "" when none need loading from Google. */
export function fontHref(theme: Theme): string {
  const uploaded = new Set(theme.customFonts.map((f) => cleanFontName(f.name)));
  const families = [...new Set([theme.font, theme.headingFont].map(cleanFontName))].filter(
    (f) => f && f !== "system" && !uploaded.has(f),
  );
  if (!families.length) return "";
  const query = families.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/** @font-face rules for uploaded fonts. */
export function fontFaceCss(theme: Theme, urlFor: (assetId: string) => string): string {
  return theme.customFonts
    .filter((f) => cleanFontName(f.name) && /^[0-9a-f]+$/.test(f.assetId))
    .map((f) => `@font-face{font-family:"${cleanFontName(f.name)}";src:url("${urlFor(f.assetId)}");font-display:swap}`)
    .join("\n");
}

const round = (value: number) => (value >= ROUND_MAX ? "999px" : `${Math.max(0, value)}px`);

const BUTTON_PADDING = { small: "8px 14px", medium: "11px 18px", large: "14px 26px" };

export function themeVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    "--bk-bg": c.background,
    "--bk-card": c.card,
    "--bk-text": c.text,
    "--bk-muted": c.muted,
    "--bk-primary": c.primary,
    "--bk-primary-text": c.primaryText,
    "--bk-border": c.border,
    "--bk-date": c.date || c.primary,
    "--bk-radius": `${theme.radius}px`,
    "--bk-button-radius": round(theme.buttonRadius),
    "--bk-button-padding": BUTTON_PADDING[theme.buttonSize] ?? BUTTON_PADDING.medium,
    "--bk-day-radius": round(theme.dayRadius),
    "--bk-time-radius": round(theme.timeRadius),
    "--bk-input-radius": round(theme.inputRadius),
    "--bk-border-width": `${theme.borderWidth}px`,
    "--bk-font": fontStack(theme.font),
    "--bk-heading-font": fontStack(theme.headingFont),
    "--bk-font-size": `${theme.fontSize}px`,
    "--bk-card-width": `${theme.cardWidth}px`,
    "--bk-shadow": theme.shadow ? "0 1px 2px rgba(16,24,40,.06), 0 12px 32px rgba(16,24,40,.08)" : "none",
  };
}

/** Recursively fills gaps in stored settings with defaults, so new fields appear after upgrades. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return patch as T;
  if (typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    out[key] = key in out ? mergeDeep(out[key], value) : value;
  }
  return out as T;
}

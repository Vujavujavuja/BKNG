export type InfoBlockId = "logo" | "business" | "title" | "description" | "details";

export interface ThemeColors {
  background: string;
  card: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  border: string;
}

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
  font: string;
  headingFont: string;
  fontSize: number;
  radius: number;
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
  },
  backgroundAssetId: "",
  backgroundOverlay: 0,
  font: "system",
  headingFont: "system",
  fontSize: 15,
  radius: 12,
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

export function fontStack(font: string): string {
  return font === "system" ? SYSTEM_STACK : `"${font}", ${SYSTEM_STACK}`;
}

/** Google Fonts stylesheet for the fonts a theme uses, or "" when only system fonts are used. */
export function fontHref(theme: Theme): string {
  const families = [...new Set([theme.font, theme.headingFont])].filter((f) => f !== "system");
  if (!families.length) return "";
  const query = families.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

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
    "--bk-radius": `${theme.radius}px`,
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

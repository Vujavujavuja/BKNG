import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { fontFaceCss, fontHref, themeVars, type Theme } from "../../../shared/theme";
import type { BookingView, PublicEventType } from "../../../shared/types";
import { assetUrl, BASE } from "../lib/api";
import { allTimezones, browserTimezone, dateKey, formatDate, formatDateKey, formatTime, MONTHS, WEEKDAYS } from "../lib/time";
import "./booking.css";

const HOUR = 3_600_000;

const icon = (path: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
const ClockIcon = () => icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const PinIcon = () => icon(<><path d="M15 10l5-3v10l-5-3z" /><rect x="3" y="6" width="12" height="12" rx="2" /></>);
const CalendarIcon = () => icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
const GlobeIcon = () => icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.500 0 18M12 3c-3 3.500-3 14.500 0 18" /></>);
const ChevronLeft = () => icon(<path d="M15 6l-6 6 6 6" />);
const ChevronRight = () => icon(<path d="M9 6l6 6-6 6" />);
const CheckIcon = () => icon(<path d="M5 12l5 5 9-10" />, 22);

export function Shell(props: {
  theme: Theme;
  children: ReactNode;
  embed?: boolean;
  single?: boolean;
}) {
  const { theme } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const href = fontHref(theme);

  useEffect(() => {
    if (!href) return;
    let link = document.getElementById("bk-fonts") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = "bk-fonts";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [href]);

  // Inside an iframe on someone's site, report our height so the frame can grow to fit.
  useEffect(() => {
    if (!props.embed || !rootRef.current) return;
    const observer = new ResizeObserver(() => {
      window.parent.postMessage({ bkngHeight: Math.ceil(rootRef.current!.scrollHeight) + 8 }, "*");
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [props.embed]);

  const background = assetUrl(theme.backgroundAssetId);
  const fontFaces = fontFaceCss(theme, assetUrl);
  return (
    <div ref={rootRef} className={`bk-root ${props.embed ? "bk-embed" : ""}`} data-button={theme.buttonStyle} data-day={theme.dayStyle} style={themeVars(theme) as CSSProperties}>
      {background && !props.embed && (
        <>
          <div className="bk-bg-image" style={{ backgroundImage: `url("${background}")` }} />
          <div className="bk-bg-overlay" style={{ opacity: theme.backgroundOverlay / 100 }} />
        </>
      )}
      {fontFaces && <style>{fontFaces}</style>}
      {theme.customCss && <style>{theme.customCss}</style>}
      <div className={`bk-card ${props.single ? "bk-single" : theme.layout === "stacked" ? "bk-stacked" : ""}`}>{props.children}</div>
      {!theme.hideBranding && (
        <a className="bk-powered" href="https://github.com/Vujavujavuja/BKNG" target="_blank" rel="noreferrer">
          Powered by BKNG
        </a>
      )}
    </div>
  );
}

export function InfoPanel(props: {
  theme: Theme;
  businessName: string;
  event: Pick<PublicEventType, "title" | "description" | "durationMinutes" | "locationLabel">;
  chosen?: number | null;
  tz: string;
}) {
  const { theme, event } = props;
  const logo = assetUrl(theme.logoAssetId);
  const blocks: Record<string, ReactNode> = {
    logo: logo ? <img className="bk-logo" src={logo} alt={props.businessName} style={{ height: theme.logoHeight }} /> : null,
    business: props.businessName ? <div className="bk-business">{props.businessName}</div> : null,
    title: <h1>{event.title}</h1>,
    description: event.description ? <div className="bk-description">{event.description}</div> : null,
    details: (
      <ul className="bk-details">
        <li>
          <ClockIcon />
          {event.durationMinutes} min
        </li>
        {event.locationLabel && (
          <li>
            <PinIcon />
            {event.locationLabel}
          </li>
        )}
        {props.chosen != null && (
          <li className="bk-chosen">
            <CalendarIcon />
            <span>
              {formatDate(props.chosen, props.tz)}
              <br />
              {formatTime(props.chosen, props.tz, theme.timeFormat)} –{" "}
              {formatTime(props.chosen + event.durationMinutes * 60_000, props.tz, theme.timeFormat)}
            </span>
          </li>
        )}
      </ul>
    ),
  };
  return (
    <div className="bk-info">
      {theme.infoBlocks.filter((b) => b.visible).map((b) => blocks[b.id] && <div key={b.id}>{blocks[b.id]}</div>)}
    </div>
  );
}

export type SlotLoader = (from: number, to: number) => Promise<number[]>;

export function SlotPicker(props: {
  theme: Theme;
  tz: string;
  onTz: (tz: string) => void;
  loadSlots: SlotLoader;
  value: number | null;
  onChange: (slot: number | null) => void;
  reloadKey?: number;
}) {
  const { theme, tz, loadSlots } = props;
  const today = dateKey(Date.now(), tz);
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [byDay, setByDay] = useState<Map<string, number[]> | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const firstLoad = useRef(true);
  const zones = useMemo(() => allTimezones(tz), [tz]);
  const monthKey = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;

  useEffect(() => {
    let live = true;
    setByDay(null);
    setFailed(false);
    // Pad by the largest timezone offset so the month's first and last local days are complete.
    loadSlots(Date.UTC(cursor.y, cursor.m, 1) - 14 * HOUR, Date.UTC(cursor.y, cursor.m + 1, 1) + 14 * HOUR)
      .then((slots) => {
        if (!live) return;
        const grouped = new Map<string, number[]>();
        for (const slot of slots) {
          const key = dateKey(slot, tz);
          if (!key.startsWith(monthKey)) continue;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(slot);
        }
        // Nothing left this month on first view: show the next month instead of an empty calendar.
        if (firstLoad.current && !grouped.size) {
          firstLoad.current = false;
          setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
          return;
        }
        firstLoad.current = false;
        setByDay(grouped);
        setDay((current) => (current && grouped.has(current) ? current : ([...grouped.keys()].sort()[0] ?? null)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [cursor.y, cursor.m, tz, loadSlots, monthKey, props.reloadKey]);

  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay() - theme.weekStart + 7) % 7;
  const isCurrentMonth = monthKey === today.slice(0, 7);
  const move = (delta: number) => {
    props.onChange(null);
    setCursor((c) => {
      const index = c.y * 12 + c.m + delta;
      return { y: Math.floor(index / 12), m: index % 12 };
    });
  };
  const times = (day && byDay?.get(day)) || [];

  return (
    <div>
      <div className="bk-month">
        <span aria-live="polite">
          {MONTHS[cursor.m]} {cursor.y}
        </span>
        <span className="bk-month-nav">
          <button type="button" className="bk-icon-button" onClick={() => move(-1)} disabled={isCurrentMonth} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <button type="button" className="bk-icon-button" onClick={() => move(1)} aria-label="Next month">
            <ChevronRight />
          </button>
        </span>
      </div>
      <div className="bk-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={`w${i}`} className="bk-weekday">
            {WEEKDAYS[(i + theme.weekStart) % 7]!.slice(0, 3)}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`o${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const key = `${monthKey}-${String(i + 1).padStart(2, "0")}`;
          const open = Boolean(byDay?.has(key));
          return (
            <button
              key={key}
              type="button"
              disabled={!open}
              className={`bk-day ${open ? "bk-open" : ""} ${day === key ? "bk-selected" : ""}`}
              aria-label={formatDateKey(key)}
              aria-pressed={day === key}
              onClick={() => {
                setDay(key);
                props.onChange(null);
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {failed ? (
        <p className="bk-error" style={{ marginTop: 16 }}>
          Times could not be loaded. Please refresh the page.
        </p>
      ) : !byDay ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <div className="bk-spinner" role="status" aria-label="Loading times" />
        </div>
      ) : (
        <>
          <div className="bk-times-title">{day ? formatDateKey(day) : theme.texts.pickTime}</div>
          {times.length ? (
            <div className="bk-times">
              {times.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`bk-time ${props.value === slot ? "bk-selected" : ""}`}
                  aria-pressed={props.value === slot}
                  onClick={() => props.onChange(slot)}
                >
                  {formatTime(slot, tz, theme.timeFormat)}
                </button>
              ))}
            </div>
          ) : (
            <p className="bk-muted">{theme.texts.noSlots}</p>
          )}
        </>
      )}

      <label className="bk-tz">
        <GlobeIcon />
        <select value={tz} onChange={(e) => props.onTz(e.target.value)} aria-label="Timezone">
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export interface FormValues {
  name: string;
  email: string;
  answers: Record<string, string | boolean>;
}

function DetailsFields(props: { theme: Theme; event: PublicEventType; values: FormValues; onChange: (v: FormValues) => void }) {
  const { values, onChange, theme } = props;
  const answer = (id: string, value: string | boolean) => onChange({ ...values, answers: { ...values.answers, [id]: value } });
  return (
    <>
      <label className="bk-field">
        {theme.texts.nameLabel}
        <input required autoComplete="name" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} />
      </label>
      <label className="bk-field">
        {theme.texts.emailLabel}
        <input required type="email" autoComplete="email" value={values.email} onChange={(e) => onChange({ ...values, email: e.target.value })} />
      </label>
      {props.event.questions.map((q) => {
        const value = values.answers[q.id];
        if (q.type === "checkbox") {
          return (
            <label key={q.id} className="bk-check">
              <input type="checkbox" required={q.required} checked={value === true} onChange={(e) => answer(q.id, e.target.checked)} />
              {q.label}
            </label>
          );
        }
        return (
          <label key={q.id} className="bk-field">
            <span>
              {q.label}
              {!q.required && <span className="bk-muted"> (optional)</span>}
            </span>
            {q.type === "textarea" ? (
              <textarea required={q.required} placeholder={q.placeholder} value={String(value ?? "")} onChange={(e) => answer(q.id, e.target.value)} />
            ) : q.type === "select" ? (
              <select required={q.required} value={String(value ?? "")} onChange={(e) => answer(q.id, e.target.value)}>
                <option value="">Choose…</option>
                {q.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={q.type === "phone" ? "tel" : "text"}
                required={q.required}
                placeholder={q.placeholder}
                value={String(value ?? "")}
                onChange={(e) => answer(q.id, e.target.value)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}

function googleLink(booking: BookingView): string {
  const stamp = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: booking.eventTitle,
    dates: `${stamp(booking.start)}/${stamp(booking.end)}`,
    location: booking.locationUrl,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function Confirmation(props: { theme: Theme; booking: BookingView; tz: string; preview?: boolean }) {
  const { theme, booking, tz } = props;
  const manage = `${BASE}/booking/${booking.token}`;
  return (
    <div className="bk-done">
      <div className="bk-done-icon">
        <CheckIcon />
      </div>
      <h2 style={{ margin: 0 }}>{theme.texts.confirmTitle}</h2>
      <div className="bk-muted">{theme.texts.confirmMessage}</div>
      <div className="bk-summary">
        <strong>{formatDate(booking.start, tz)}</strong>
        {formatTime(booking.start, tz, theme.timeFormat)} – {formatTime(booking.end, tz, theme.timeFormat)}
        <span className="bk-muted"> ({tz.replace(/_/g, " ")})</span>
      </div>
      <div className="bk-links">
        <a className="bk-button bk-secondary" href={props.preview ? undefined : googleLink(booking)} target="_blank" rel="noreferrer">
          {theme.texts.addToCalendar}: Google
        </a>
        <a className="bk-button bk-secondary" href={props.preview ? undefined : `${BASE}/api/public/bookings/${booking.token}/invite.ics`}>
          {theme.texts.addToCalendar}: other
        </a>
      </div>
      <a className="bk-text-link" href={props.preview ? undefined : manage}>
        {theme.texts.manageLabel}
      </a>
    </div>
  );
}

export interface BookingRequest {
  start: number;
  name: string;
  email: string;
  tz: string;
  answers: Record<string, string | boolean>;
}

export function BookingFlow(props: {
  theme: Theme;
  businessName: string;
  event: PublicEventType;
  loadSlots: SlotLoader;
  submit: (request: BookingRequest) => Promise<BookingView>;
  embed?: boolean;
  /** Design preview: nothing is really booked and outgoing links are switched off. */
  preview?: boolean;
}) {
  const { theme, event } = props;
  const firstStep = theme.stepOrder === "time-first" ? "time" : "form";
  const [step, setStep] = useState<"time" | "form" | "done">(firstStep);
  const [tz, setTz] = useState(browserTimezone);
  const [slot, setSlot] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({ name: "", email: "", answers: {} });
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // In the design preview, switching the step order should show the new first step straight away.
  useEffect(() => {
    if (props.preview) setStep((current) => (current === "done" ? current : firstStep));
  }, [firstStep, props.preview]);

  const isLast = step !== firstStep;
  const confirm = async () => {
    if (slot == null) return;
    setBusy(true);
    setError("");
    try {
      setBooking(await props.submit({ start: slot, tz, ...values }));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      // Most failures mean the time was taken meanwhile, so show fresh times.
      setSlot(null);
      setStep("time");
      setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };
  const next = () => (isLast ? confirm() : setStep(firstStep === "time" ? "form" : "time"));
  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void next();
  };

  const actions = (canContinue: boolean, asSubmit: boolean) => (
    <div className="bk-actions">
      {isLast && (
        <button type="button" className="bk-button bk-secondary" onClick={() => setStep(firstStep)} disabled={busy}>
          {theme.texts.backLabel}
        </button>
      )}
      <button type={asSubmit ? "submit" : "button"} className="bk-button" disabled={!canContinue || busy} onClick={asSubmit ? undefined : () => void next()}>
        {busy ? "…" : isLast ? theme.texts.submitLabel : theme.texts.nextLabel}
      </button>
    </div>
  );

  return (
    <Shell theme={theme} embed={props.embed}>
      <InfoPanel theme={theme} businessName={props.businessName} event={event} chosen={slot} tz={tz} />
      <div className="bk-main">
        {step === "done" && booking ? (
          <Confirmation theme={theme} booking={booking} tz={tz} preview={props.preview} />
        ) : step === "time" ? (
          <>
            <h2>{theme.texts.pickDate}</h2>
            {error && <p className="bk-error" role="alert">{error}</p>}
            <SlotPicker theme={theme} tz={tz} onTz={setTz} loadSlots={props.loadSlots} value={slot} onChange={setSlot} reloadKey={reloadKey} />
            {actions(slot != null, false)}
          </>
        ) : (
          <form className="bk-form" onSubmit={onFormSubmit}>
            <h2 style={{ marginBottom: 2 }}>{theme.texts.formTitle}</h2>
            {error && <p className="bk-error" role="alert">{error}</p>}
            <DetailsFields theme={theme} event={event} values={values} onChange={setValues} />
            {actions(true, true)}
          </form>
        )}
      </div>
    </Shell>
  );
}


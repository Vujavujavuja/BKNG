import { useCallback, useEffect, useState } from "react";
import { mergeDeep, DEFAULT_THEME, type Theme } from "../../../shared/theme";
import type { BookingView, PublicEventType } from "../../../shared/types";
import { api, BASE, boot, send } from "../lib/api";
import { Link, usePath } from "../lib/router";
import { browserTimezone, formatDate, formatTime } from "../lib/time";
import { BookingFlow, InfoPanel, Shell, SlotPicker, type BookingRequest } from "./Booking";

interface Site {
  businessName: string;
  timezone: string;
  theme: Theme;
  eventTypes: PublicEventType[];
}

const query = new URLSearchParams(window.location.search);
const embed = query.has("embed");
/** Shown inside the admin's design editor: takes the draft design from the parent window and books nothing. */
const preview = query.has("preview");

function Message(props: { theme: Theme; title: string; children?: React.ReactNode }) {
  return (
    <Shell theme={props.theme} embed={embed} single>
      <div className="bk-main">
        <h2>{props.title}</h2>
        <div className="bk-muted">{props.children}</div>
      </div>
    </Shell>
  );
}

function EventPage(props: { site: Site; event: PublicEventType }) {
  const { site, event } = props;
  const loadSlots = useCallback(
    (from: number, to: number) => api<{ slots: number[] }>(`/public/event-types/${event.slug}/slots?from=${from}&to=${to}`).then((r) => r.slots),
    [event.slug],
  );
  const submit = async (request: BookingRequest): Promise<BookingView> => {
    if (preview) {
      return {
        token: "preview",
        status: "confirmed",
        start: request.start,
        end: request.start + event.durationMinutes * 60_000,
        bookerName: request.name,
        bookerEmail: request.email,
        bookerTz: request.tz,
        eventTitle: event.title,
        eventSlug: event.slug,
        durationMinutes: event.durationMinutes,
        locationUrl: "",
        locationLabel: event.locationLabel,
      };
    }
    const result = await send<{ booking?: BookingView }>("POST", "/public/bookings", { slug: event.slug, ...request });
    if (!result.booking) throw new Error("The booking didn't go through. Please try again.");
    return result.booking;
  };
  return <BookingFlow theme={site.theme} businessName={site.businessName} event={event} loadSlots={loadSlots} submit={submit} embed={embed} preview={preview} />;
}

function Landing({ site }: { site: Site }) {
  return (
    <Shell theme={site.theme} embed={embed} single>
      <div className="bk-main">
        <h1>{site.theme.texts.landingTitle}</h1>
        <p className="bk-muted">{site.theme.texts.landingSubtitle}</p>
        <div className="bk-list">
          {site.eventTypes.map((event) => (
            <Link key={event.slug} to={`/${event.slug}`} className="bk-list-item">
              <span>
                <strong>{event.title}</strong>
                <span className="bk-muted">{event.description.split("\n")[0]}</span>
              </span>
              <span className="bk-muted" style={{ whiteSpace: "nowrap" }}>
                {event.durationMinutes} min
              </span>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function ManagePage(props: { site: Site; token: string }) {
  const { theme } = props.site;
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [slot, setSlot] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [tz, setTz] = useState(browserTimezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ booking: BookingView }>(`/public/bookings/${props.token}`)
      .then((r) => setBooking(r.booking))
      .catch(() => setMissing(true));
  }, [props.token]);

  const slug = booking?.eventSlug;
  const loadSlots = useCallback(
    (from: number, to: number) =>
      api<{ slots: number[] }>(`/public/event-types/${slug}/slots?from=${from}&to=${to}&booking=${props.token}`).then((r) => r.slots),
    [slug, props.token],
  );

  if (missing) return <Message theme={theme} title="Booking not found">This link may be out of date.</Message>;
  if (!booking) return <Message theme={theme} title="Loading…" />;

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await send<{ booking: BookingView }>("POST", `/public/bookings/${props.token}/${path}`, body);
      setBooking(result.booking);
      setMode("view");
      setSlot(null);
      setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const event = { title: booking.eventTitle, description: "", durationMinutes: booking.durationMinutes, locationLabel: booking.locationLabel };
  const cancelled = booking.status === "cancelled";
  const past = booking.start < Date.now();

  return (
    <Shell theme={theme} embed={embed}>
      <InfoPanel theme={theme} businessName={props.site.businessName} event={event} chosen={mode === "reschedule" ? slot : null} tz={tz} />
      <div className="bk-main">
        {error && <p className="bk-error" role="alert">{error}</p>}
        {mode === "reschedule" ? (
          <>
            <h2>{theme.texts.pickDate}</h2>
            <SlotPicker theme={theme} tz={tz} onTz={setTz} loadSlots={loadSlots} value={slot} onChange={setSlot} />
            <div className="bk-actions">
              <button className="bk-button bk-secondary" onClick={() => setMode("view")} disabled={busy}>
                {theme.texts.backLabel}
              </button>
              <button className="bk-button" disabled={slot == null || busy} onClick={() => act("reschedule", { start: slot }, "Your booking was moved. An updated invite is on its way.")}>
                {theme.texts.rescheduleLabel}
              </button>
            </div>
          </>
        ) : mode === "cancel" ? (
          <form
            className="bk-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act("cancel", { reason }, "");
            }}
          >
            <h2 style={{ marginBottom: 2 }}>{theme.texts.cancelLabel}</h2>
            <label className="bk-field">
              <span>
                Reason <span className="bk-muted">(optional)</span>
              </span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="bk-actions">
              <button type="button" className="bk-button bk-secondary" onClick={() => setMode("view")} disabled={busy}>
                {theme.texts.backLabel}
              </button>
              <button className="bk-button" disabled={busy}>
                {theme.texts.cancelLabel}
              </button>
            </div>
          </form>
        ) : (
          <div className="bk-done">
            <h2 style={{ margin: 0 }}>{cancelled ? theme.texts.cancelledTitle : theme.texts.confirmTitle}</h2>
            {notice && <div className="bk-muted">{notice}</div>}
            <div className="bk-summary" style={cancelled ? { textDecoration: "line-through" } : undefined}>
              <strong>{formatDate(booking.start, tz)}</strong>
              {formatTime(booking.start, tz, theme.timeFormat)} – {formatTime(booking.end, tz, theme.timeFormat)}
              <span className="bk-muted"> ({tz.replace(/_/g, " ")})</span>
            </div>
            {!cancelled && booking.locationUrl && (
              <a className="bk-text-link" href={booking.locationUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                {booking.locationUrl}
              </a>
            )}
            {!cancelled && !past && (
              <div className="bk-links">
                <button className="bk-button bk-secondary" onClick={() => setMode("reschedule")}>
                  {theme.texts.rescheduleLabel}
                </button>
                <button className="bk-button bk-danger" onClick={() => setMode("cancel")}>
                  {theme.texts.cancelLabel}
                </button>
              </div>
            )}
            {cancelled && (
              <a className="bk-button" href={`${BASE}/${booking.eventSlug}`}>
                Book a new time
              </a>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function PublicApp() {
  const path = usePath();
  const [loaded, setSite] = useState<Site | null>(null);
  const [draftTheme, setDraftTheme] = useState<Theme | null>(null);
  const [failed, setFailed] = useState(false);
  const site = loaded && draftTheme ? { ...loaded, theme: draftTheme } : loaded;

  useEffect(() => {
    if (!preview || window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.bkngTheme) setDraftTheme(mergeDeep(DEFAULT_THEME, e.data.bkngTheme));
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ bkngReady: true }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    api<Site>("/public/site")
      .then((s) => setSite({ ...s, theme: mergeDeep(DEFAULT_THEME, s.theme) }))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    document.body.style.margin = "0";
  }, []);

  if (failed) return <Message theme={boot.theme} title="This page could not be loaded">Please refresh to try again.</Message>;
  if (!site) return <Shell theme={boot.theme} embed={embed} single><div className="bk-main" style={{ display: "flex", justifyContent: "center" }}><div className="bk-spinner" role="status" aria-label="Loading" /></div></Shell>;

  const manage = /^\/booking\/([^/]+)\/?$/.exec(path);
  if (manage) return <ManagePage site={site} token={manage[1]!} />;

  const slug = path.replace(/^\/+|\/+$/g, "");
  if (slug) {
    const event = site.eventTypes.find((e) => e.slug === slug);
    if (!event) return <Message theme={site.theme} title="Page not found">This booking link doesn't exist or was switched off.</Message>;
    return <EventPage key={event.slug} site={site} event={event} />;
  }
  if (!site.eventTypes.length) {
    return (
      <Message theme={site.theme} title="Nothing to book yet">
        This booking page is still being set up. If it's yours, <Link to="/admin" className="bk-text-link">open the admin panel</Link>.
      </Message>
    );
  }
  if (site.eventTypes.length === 1) return <EventPage site={site} event={site.eventTypes[0]!} />;
  return <Landing site={site} />;
}

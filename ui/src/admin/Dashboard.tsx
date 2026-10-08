import type { AdminBooking } from "../../../shared/types";
import { Link } from "../lib/router";
import { formatShortDate, formatTime } from "../lib/time";
import { Card, CopyButton, Loading, PageHead, useLoad } from "./ui";

interface DashboardData {
  stats: { upcoming: number; week: number; booked30: number; cancelled30: number };
  series: { date: string; count: number }[];
  byType: { title: string; count: number }[];
  next: AdminBooking[];
  checklist: { eventType: boolean; calendar: boolean; email: boolean; domain: boolean };
  warnings: { calendarErrors: number; failedEmails: number };
  publicUrl: string;
  timezone: string;
}

const shortDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y!, m! - 1, d!));
};

function BookingsChart({ series }: { series: DashboardData["series"] }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <>
      <div className="ad-chart" role="img" aria-label="Bookings made per day over the last 30 days">
        {series.map((point) => (
          <div key={point.date} className="ad-bar-slot" tabIndex={0}>
            <div className="ad-bar" style={{ height: `${(point.count / max) * 100}%` }} />
            <span className="ad-bar-tip">
              {shortDay(point.date)}: {point.count}
            </span>
          </div>
        ))}
      </div>
      <div className="ad-chart-axis">
        <span>{shortDay(series[0]!.date)}</span>
        <span>Most in a day: {Math.max(...series.map((s) => s.count))}</span>
        <span>{shortDay(series[series.length - 1]!.date)}</span>
      </div>
      <table className="ad-sr">
        <caption>Bookings made per day</caption>
        <tbody>
          {series.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const STEPS: { key: keyof DashboardData["checklist"]; label: string; to: string }[] = [
  { key: "eventType", label: "Create a meeting type", to: "/admin/types" },
  { key: "calendar", label: "Connect a calendar so busy times are blocked", to: "/admin/calendars" },
  { key: "email", label: "Set up email so confirmations are sent", to: "/admin/emails" },
  { key: "domain", label: "Put the booking page on your own domain", to: "/admin/domain" },
];

export function Dashboard() {
  const { data, error } = useLoad<DashboardData>("/admin/dashboard");
  if (!data) return <Loading error={error} />;
  const todo = STEPS.filter((s) => !data.checklist[s.key]).length;
  const total30 = data.byType.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="ad-stack">
      <PageHead title="Dashboard" description="How your booking page is doing." />

      {data.publicUrl && (
        <Card>
          <div className="ad-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3>Your booking page</h3>
              <a href={data.publicUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                {data.publicUrl}
              </a>
            </div>
            <CopyButton text={data.publicUrl} label="Copy link" />
          </div>
        </Card>
      )}

      {(data.warnings.calendarErrors > 0 || data.warnings.failedEmails > 0) && (
        <div className="ad-note is-bad">
          {data.warnings.calendarErrors > 0 && (
            <div>
              {data.warnings.calendarErrors} calendar{data.warnings.calendarErrors > 1 ? "s" : ""} could not be read, so busy times may be out of date. <Link to="/admin/calendars">Check calendars</Link>
            </div>
          )}
          {data.warnings.failedEmails > 0 && (
            <div>
              {data.warnings.failedEmails} email{data.warnings.failedEmails > 1 ? "s" : ""} failed to send in the last week. <Link to="/admin/emails">Check email</Link>
            </div>
          )}
        </div>
      )}

      <div className="ad-stats">
        {[
          ["Upcoming bookings", data.stats.upcoming],
          ["In the next 7 days", data.stats.week],
          ["Booked in the last 30 days", data.stats.booked30],
          ["Cancelled in the last 30 days", data.stats.cancelled30],
        ].map(([label, value]) => (
          <div key={label} className="ad-card">
            <h3>{label}</h3>
            <div className="ad-stat-value">{value}</div>
          </div>
        ))}
      </div>

      {todo > 0 && (
        <Card title="Finish setting up" description={`${STEPS.length - todo} of ${STEPS.length} done`}>
          {STEPS.map((step) => (
            <div key={step.key} className={`ad-check ${data.checklist[step.key] ? "is-done" : ""}`}>
              <span className="ad-check-dot" aria-hidden="true">
                {data.checklist[step.key] ? "✓" : ""}
              </span>
              {data.checklist[step.key] ? <span className="ad-muted">{step.label}</span> : <Link to={step.to}>{step.label}</Link>}
            </div>
          ))}
        </Card>
      )}

      <Card title="Bookings made per day" description="Last 30 days">
        <BookingsChart series={data.series} />
      </Card>

      <div className="ad-grid-2">
        <Card title="Coming up" actions={<Link to="/admin/bookings">All bookings</Link>}>
          {data.next.length ? (
            <div className="ad-list">
              {data.next.map((b) => (
                <div key={b.id} className="ad-item">
                  <div className="ad-item-body">
                    <strong>{b.bookerName}</strong> <span className="ad-muted">· {b.eventTitle}</span>
                    <div className="ad-muted ad-small">
                      {formatShortDate(b.start, data.timezone)}, {formatTime(b.start, data.timezone, "24h")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-empty">Nothing booked yet.</div>
          )}
        </Card>
        <Card title="By meeting type" description="Last 30 days">
          {data.byType.length ? (
            <div className="ad-list">
              {data.byType.map((t) => (
                <div key={t.title}>
                  <div className="ad-row">
                    <span>{t.title}</span>
                    <span className="ad-spacer" />
                    <strong>{t.count}</strong>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--bg)", marginTop: 4 }}>
                    <div style={{ height: 6, borderRadius: 4, background: "var(--accent)", width: `${(t.count / total30) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-empty">No bookings in this period.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

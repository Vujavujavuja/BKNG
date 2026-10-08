import { useState } from "react";
import type { AdminBooking } from "../../../shared/types";
import { boot, send } from "../lib/api";
import { formatShortDate, formatTime } from "../lib/time";
import { Button, Card, Loading, PageHead, Tabs, toast, toastError, useLoad } from "./ui";

type Scope = "upcoming" | "past" | "cancelled";

export function Bookings() {
  const [scope, setScope] = useState<Scope>("upcoming");
  const { data, error, reload } = useLoad<{ bookings: AdminBooking[] }>(`/admin/bookings?scope=${scope}`);
  const [open, setOpen] = useState<string | null>(null);
  const tz = boot.timezone;

  const cancel = async (booking: AdminBooking) => {
    const reason = window.prompt(`Cancel the booking with ${booking.bookerName}? They will be emailed. You can add a reason:`, "");
    if (reason === null) return;
    try {
      await send("POST", `/admin/bookings/${booking.id}/cancel`, { reason });
      toast("Booking cancelled");
      void reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="ad-stack">
      <PageHead title="Bookings" description={`Times are shown in ${tz.replace(/_/g, " ")}.`} />
      <Card>
        <Tabs
          value={scope}
          onChange={setScope}
          tabs={[
            { id: "upcoming", label: "Upcoming" },
            { id: "past", label: "Past" },
            { id: "cancelled", label: "Cancelled" },
          ]}
        />
        {!data ? (
          <Loading error={error} />
        ) : !data.bookings.length ? (
          <div className="ad-empty">No {scope} bookings.</div>
        ) : (
          <div className="ad-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Meeting</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b) => {
                  const answers = Object.entries(b.answers);
                  return (
                    <tr key={b.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <strong>{formatShortDate(b.start, tz)}</strong>
                        <div className="ad-muted">
                          {formatTime(b.start, tz, boot.theme.timeFormat)} – {formatTime(b.end, tz, boot.theme.timeFormat)}
                        </div>
                      </td>
                      <td>
                        <strong>{b.bookerName}</strong>
                        <div>
                          <a href={`mailto:${b.bookerEmail}`}>{b.bookerEmail}</a>
                        </div>
                        {open === b.id && (
                          <div className="ad-small" style={{ marginTop: 6 }}>
                            <div className="ad-muted">Their timezone: {b.bookerTz.replace(/_/g, " ")}</div>
                            {answers.map(([question, answer]) => (
                              <div key={question} style={{ whiteSpace: "pre-wrap" }}>
                                <strong>{question}:</strong> {answer}
                              </div>
                            ))}
                            {b.cancelReason && <div>Cancel reason: {b.cancelReason}</div>}
                          </div>
                        )}
                      </td>
                      <td>{b.eventTitle}</td>
                      <td>
                        <div className="ad-row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          <Button variant="ghost" small onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                            {open === b.id ? "Less" : "Details"}
                          </Button>
                          {scope === "upcoming" && (
                            <Button variant="danger" small onClick={() => void cancel(b)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

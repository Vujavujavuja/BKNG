import { useEffect, useState } from "react";
import { DEFAULT_EVENT_CONFIG, type CalendarRow, type EventType, type EventTypeConfig, type Question, type QuestionType, type TimeWindow } from "../../../shared/types";
import { api, ORIGIN, send } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { WEEKDAYS } from "../lib/time";
import { Button, Card, CopyButton, Field, Loading, NumberField, PageHead, SaveBar, Sortable, Toggle, toast, toastError, useDraft, useLoad } from "./ui";

export function EventTypes() {
  const { data, setData, error, reload } = useLoad<{ eventTypes: EventType[] }>("/admin/event-types");
  if (!data) return <Loading error={error} />;

  const reorder = (eventTypes: EventType[]) => {
    setData({ eventTypes });
    send("POST", "/admin/event-types/reorder", { ids: eventTypes.map((e) => e.id) }).catch(toastError);
  };
  const toggle = async (eventType: EventType, active: boolean) => {
    try {
      await send("PUT", `/admin/event-types/${eventType.id}`, { ...eventType, active });
      void reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="ad-stack">
      <PageHead
        title="Meeting types"
        description="Each one gets its own booking link, length, hours and questions."
        actions={
          <Link to="/admin/types/new" className="ad-btn">
            New meeting type
          </Link>
        }
      />
      {data.eventTypes.length ? (
        <Sortable
          items={data.eventTypes}
          keyOf={(e) => e.id}
          onChange={reorder}
          render={(e) => (
            <div className="ad-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/admin/types/${e.id}`} style={{ fontWeight: 600 }}>
                  {e.title}
                </Link>
                <div className="ad-muted ad-small" style={{ overflowWrap: "anywhere" }}>
                  {e.durationMinutes} min · {ORIGIN}/{e.slug}
                </div>
              </div>
              <Toggle checked={e.active} onChange={(active) => void toggle(e, active)} label={e.active ? "On" : "Off"} />
              <CopyButton text={`${ORIGIN}/${e.slug}`} label="Copy link" />
            </div>
          )}
        />
      ) : (
        <Card>
          <div className="ad-empty">No meeting types yet. Create one to start taking bookings.</div>
        </Card>
      )}
    </div>
  );
}

const NEW_EVENT: EventType = {
  id: "new",
  slug: "",
  title: "",
  description: "",
  durationMinutes: 30,
  active: true,
  position: 0,
  config: DEFAULT_EVENT_CONFIG,
};

const QUESTION_TYPES: { id: QuestionType; label: string }[] = [
  { id: "text", label: "Short answer" },
  { id: "textarea", label: "Long answer" },
  { id: "select", label: "Dropdown" },
  { id: "checkbox", label: "Checkbox" },
  { id: "phone", label: "Phone number" },
];

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

function Windows(props: { windows: TimeWindow[]; onChange: (windows: TimeWindow[]) => void; label: string }) {
  const { windows, onChange } = props;
  return (
    <div className="ad-stack" style={{ gap: 6 }}>
      {windows.map((w, i) => (
        <div key={i} className="ad-row" style={{ flexWrap: "nowrap" }}>
          <input type="time" value={w.start} aria-label={`${props.label} from`} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="ad-muted">to</span>
          <input type="time" value={w.end} aria-label={`${props.label} until`} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          <Button variant="ghost" small aria-label="Remove these hours" onClick={() => onChange(windows.filter((_, j) => j !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <div>
        <Button variant="ghost" small onClick={() => onChange([...windows, windows.length ? { start: windows[windows.length - 1]!.end, end: "23:00" } : { start: "09:00", end: "17:00" }])}>
          + Add hours
        </Button>
      </div>
    </div>
  );
}

function QuestionEditor(props: { question: Question; onChange: (q: Question) => void; onRemove: () => void }) {
  const { question: q, onChange } = props;
  return (
    <div className="ad-stack" style={{ gap: 8 }}>
      <div className="ad-row">
        <input type="text" style={{ flex: 2, minWidth: 160 }} value={q.label} placeholder="Question" aria-label="Question" onChange={(e) => onChange({ ...q, label: e.target.value })} />
        <select style={{ flex: 1, minWidth: 130 }} value={q.type} aria-label="Answer type" onChange={(e) => onChange({ ...q, type: e.target.value as QuestionType })}>
          {QUESTION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {q.type === "select" && (
        <textarea
          aria-label="Dropdown options, one per line"
          placeholder="One option per line"
          value={(q.options ?? []).join("\n")}
          onChange={(e) => onChange({ ...q, options: e.target.value.split("\n") })}
        />
      )}
      <div className="ad-row">
        <Toggle checked={q.required} onChange={(required) => onChange({ ...q, required })} label="Required" />
        <span className="ad-spacer" />
        <Button variant="ghost" small onClick={props.onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

export function EventTypeEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const [saved, setSaved] = useState<EventType | null>(isNew ? NEW_EVENT : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const calendars = useLoad<{ calendars: CalendarRow[] }>("/admin/calendars");
  const { draft, setDraft, dirty } = useDraft(saved);

  useEffect(() => {
    if (isNew) return;
    api<{ eventTypes: EventType[] }>("/admin/event-types")
      .then((r) => {
        const found = r.eventTypes.find((e) => e.id === id);
        if (found) setSaved(found);
        else setError("That meeting type doesn't exist.");
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew]);

  if (!draft) return <Loading error={error} />;
  const config = draft.config;
  const set = (patch: Partial<EventType>) => setDraft({ ...draft, ...patch });
  const setConfig = (patch: Partial<EventTypeConfig>) => setDraft({ ...draft, config: { ...config, ...patch } });

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...draft, config: { ...config, questions: config.questions.map((q) => ({ ...q, options: q.options?.map((o) => o.trim()).filter(Boolean) })) } };
      const result = await send<{ eventType: EventType }>(isNew ? "POST" : "PUT", isNew ? "/admin/event-types" : `/admin/event-types/${id}`, body);
      toast("Saved");
      if (isNew) navigate(`/admin/types/${result.eventType.id}`, true);
      else setSaved(result.eventType);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${draft.title}"? This can't be undone.`)) return;
    try {
      await send("DELETE", `/admin/event-types/${id}`);
      navigate("/admin/types");
    } catch (e) {
      toastError(e);
    }
  };

  const googleAccounts = calendars.data?.calendars.filter((c) => c.kind === "google" && c.writeId) ?? [];
  const overrides = Object.keys(config.dateOverrides).sort();

  return (
    <div className="ad-stack">
      <PageHead
        title={isNew ? "New meeting type" : draft.title || "Meeting type"}
        actions={
          <>
            <Link to="/admin/types" className="ad-btn is-secondary">
              Back
            </Link>
            {!isNew && (
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </>
        }
      />

      <Card title="Basics">
        <div className="ad-stack">
          <div className="ad-grid-2">
            <Field label="Name">
              <input type="text" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Link name" hint={`${ORIGIN}/${draft.slug || "your-link"}`}>
              <input type="text" value={draft.slug} placeholder="Made from the name if left blank" onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            </Field>
          </div>
          <Field label="Description" hint="Shown on the booking page.">
            <textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <div className="ad-grid-3">
            <NumberField label="Length (minutes)" value={draft.durationMinutes} min={5} max={480} step={5} onChange={(durationMinutes) => set({ durationMinutes })} />
            <Field label="Where it happens" hint="Shown before booking, e.g. Video call.">
              <input type="text" value={config.locationLabel} onChange={(e) => setConfig({ locationLabel: e.target.value })} />
            </Field>
            <Field label="Meeting link" hint="Any link: Proton Meet, Zoom, Jitsi. Sent after booking.">
              <input type="url" value={config.locationUrl} placeholder="https://" onChange={(e) => setConfig({ locationUrl: e.target.value })} />
            </Field>
          </div>
          <Toggle checked={draft.active} onChange={(active) => set({ active })} label="People can book this" />
        </div>
      </Card>

      <Card title="Weekly hours" description="When you can be booked, in your own timezone. Add several ranges to leave a gap for lunch.">
        <div className="ad-stack" style={{ gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const windows = config.weeklyHours[day] ?? [];
            const update = (next: TimeWindow[]) => setConfig({ weeklyHours: { ...config.weeklyHours, [day]: next } });
            return (
              <div key={day} className="ad-row" style={{ alignItems: "flex-start" }}>
                <div style={{ width: 130, paddingTop: 6 }}>
                  <Toggle checked={windows.length > 0} onChange={(on) => update(on ? [{ start: "09:00", end: "17:00" }] : [])} label={WEEKDAYS[day]} />
                </div>
                {windows.length ? <Windows windows={windows} onChange={update} label={WEEKDAYS[day]!} /> : <span className="ad-muted" style={{ paddingTop: 6 }}>Unavailable</span>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Specific dates" description="Different hours on one date, or a day off.">
        <div className="ad-stack">
          {overrides.map((date) => {
            const windows = config.dateOverrides[date] ?? [];
            const update = (next: TimeWindow[]) => setConfig({ dateOverrides: { ...config.dateOverrides, [date]: next } });
            const removeDate = () => {
              const next = { ...config.dateOverrides };
              delete next[date];
              setConfig({ dateOverrides: next });
            };
            return (
              <div key={date} className="ad-row" style={{ alignItems: "flex-start" }}>
                <strong style={{ width: 130, paddingTop: 6 }}>{date}</strong>
                <div style={{ flex: 1 }}>
                  {!windows.length && <div className="ad-muted" style={{ padding: "6px 0" }}>Unavailable all day</div>}
                  <Windows windows={windows} onChange={update} label={date} />
                </div>
                <Button variant="ghost" small onClick={removeDate}>
                  Remove date
                </Button>
              </div>
            );
          })}
          <div className="ad-row">
            <input type="date" style={{ width: 180 }} value={overrideDate} aria-label="Date to change" onChange={(e) => setOverrideDate(e.target.value)} />
            <Button
              variant="secondary"
              disabled={!overrideDate || overrideDate in config.dateOverrides}
              onClick={() => {
                setConfig({ dateOverrides: { ...config.dateOverrides, [overrideDate]: [] } });
                setOverrideDate("");
              }}
            >
              Add date
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Booking rules">
        <div className="ad-grid-3">
          <NumberField label="Offer a start time every (minutes)" value={config.slotStepMinutes} min={5} max={480} step={5} onChange={(slotStepMinutes) => setConfig({ slotStepMinutes })} />
          <NumberField label="Minimum notice (hours)" hint="How soon before a call someone can still book." value={Math.round((config.minNoticeMinutes / 60) * 10) / 10} min={0} max={720} step={0.5} onChange={(h) => setConfig({ minNoticeMinutes: Math.round(h * 60) })} />
          <NumberField label="Bookable up to (days ahead)" value={config.maxDaysAhead} min={1} max={180} onChange={(maxDaysAhead) => setConfig({ maxDaysAhead })} />
          <NumberField label="Free time before (minutes)" value={config.bufferBeforeMinutes} min={0} max={240} step={5} onChange={(bufferBeforeMinutes) => setConfig({ bufferBeforeMinutes })} />
          <NumberField label="Free time after (minutes)" value={config.bufferAfterMinutes} min={0} max={240} step={5} onChange={(bufferAfterMinutes) => setConfig({ bufferAfterMinutes })} />
          <NumberField label="Most bookings per day" hint="0 means no limit." value={config.maxPerDay} min={0} max={50} onChange={(maxPerDay) => setConfig({ maxPerDay })} />
        </div>
      </Card>

      <Card title="Questions" description="Name and email are always asked. Add anything else you need, and drag to reorder.">
        <div className="ad-stack">
          <Sortable
            items={config.questions}
            keyOf={(q) => q.id}
            onChange={(questions) => setConfig({ questions })}
            render={(q, i) => (
              <QuestionEditor
                question={q}
                onChange={(next) => setConfig({ questions: config.questions.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setConfig({ questions: config.questions.filter((_, j) => j !== i) })}
              />
            )}
          />
          <div>
            <Button variant="secondary" onClick={() => setConfig({ questions: [...config.questions, { id: newId(), label: "", type: "text", required: false, options: [] }] })}>
              + Add question
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Notifications and calendar">
        <div className="ad-stack">
          <Field label="Send booking notices to" hint="One email per line. Leave blank to use the owner's email.">
            <textarea value={config.hostEmails.join("\n")} onChange={(e) => setConfig({ hostEmails: e.target.value.split("\n").map((s) => s.trim()) })} />
          </Field>
          <Toggle
            checked={config.sendHostInvite}
            onChange={(sendHostInvite) => setConfig({ sendHostInvite })}
            label="Attach a calendar invite to those notices (this is how bookings reach Proton, iCloud and Outlook calendars)"
          />
          <Field label="Also write bookings straight into a Google calendar" hint={googleAccounts.length ? undefined : "Connect a Google account on the Calendars page to use this."}>
            <select value={config.googleCalendarId} onChange={(e) => setConfig({ googleCalendarId: e.target.value })} disabled={!googleAccounts.length}>
              <option value="">No</option>
              {googleAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.account}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Remind the person who booked" hint="Minutes before the call, separated by commas. For example 1440, 60 sends one a day before and one an hour before. Leave blank for none.">
            <input
              type="text"
              defaultValue={config.reminderMinutes.join(", ")}
              onBlur={(e) => setConfig({ reminderMinutes: e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => n > 0) })}
            />
          </Field>
        </div>
      </Card>

      <SaveBar dirty={dirty || isNew} busy={busy} onSave={() => void save()} />
    </div>
  );
}

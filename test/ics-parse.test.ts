import { describe, expect, it } from "vitest";
import { parseIcsBusy, type IcsOptions } from "../src/lib/ics-parse";

const iso = (ts: number) => new Date(ts).toISOString();
const opts: IcsOptions = { defaultTz: "Europe/Belgrade", from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 11, 1) };

const wrap = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.split("\n"), "END:VEVENT"]), "END:VCALENDAR"].join(
    "\r\n",
  );

const busy = (ics: string, o = opts) => parseIcsBusy(ics, o).map((i) => `${iso(i.start)} ${iso(i.end)}`);

describe("parseIcsBusy", () => {
  it("reads UTC, zoned and floating times", () => {
    const ics = wrap(
      "UID:a\nDTSTART:20261012T100000Z\nDTEND:20261012T110000Z",
      "UID:b\nDTSTART;TZID=America/New_York:20261013T090000\nDTEND;TZID=America/New_York:20261013T093000",
      "UID:c\nDTSTART:20261014T090000\nDURATION:PT45M",
    );
    expect(busy(ics)).toEqual([
      "2026-10-12T10:00:00.000Z 2026-10-12T11:00:00.000Z",
      "2026-10-13T13:00:00.000Z 2026-10-13T13:30:00.000Z",
      "2026-10-14T07:00:00.000Z 2026-10-14T07:45:00.000Z",
    ]);
  });

  it("unfolds long lines and ignores alarms", () => {
    const ics = wrap("UID:a\nDTSTART:20261012T10\n 0000Z\nDTEND:20261012T110000Z\nBEGIN:VALARM\nTRIGGER:-PT10M\nEND:VALARM");
    expect(busy(ics)).toEqual(["2026-10-12T10:00:00.000Z 2026-10-12T11:00:00.000Z"]);
  });

  it("treats all-day events as the whole local day, unless ignored", () => {
    const ics = wrap("UID:a\nDTSTART;VALUE=DATE:20261012\nDTEND;VALUE=DATE:20261013");
    expect(busy(ics)).toEqual(["2026-10-11T22:00:00.000Z 2026-10-12T22:00:00.000Z"]);
    expect(busy(ics, { ...opts, ignoreAllDay: true })).toEqual([]);
  });

  it("skips cancelled and free events", () => {
    const ics = wrap(
      "UID:a\nDTSTART:20261012T100000Z\nDTEND:20261012T110000Z\nSTATUS:CANCELLED",
      "UID:b\nDTSTART:20261012T120000Z\nDTEND:20261012T130000Z\nTRANSP:TRANSPARENT",
    );
    expect(busy(ics)).toEqual([]);
  });

  it("expands a weekly series across a clock change, keeping local time", () => {
    const ics = wrap(
      "UID:a\nDTSTART;TZID=Europe/Belgrade:20260907T100000\nDTEND;TZID=Europe/Belgrade:20260907T103000\nRRULE:FREQ=WEEKLY;BYDAY=MO",
    );
    const out = busy(ics, { ...opts, from: Date.UTC(2026, 9, 19), to: Date.UTC(2026, 10, 3) });
    expect(out).toEqual([
      "2026-10-19T08:00:00.000Z 2026-10-19T08:30:00.000Z",
      "2026-10-26T09:00:00.000Z 2026-10-26T09:30:00.000Z",
      "2026-11-02T09:00:00.000Z 2026-11-02T09:30:00.000Z",
    ]);
  });

  it("honours COUNT, UNTIL, INTERVAL and EXDATE", () => {
    const count = wrap("UID:a\nDTSTART:20261005T100000Z\nDTEND:20261005T110000Z\nRRULE:FREQ=DAILY;COUNT=3");
    expect(busy(count)).toHaveLength(3);

    const until = wrap("UID:a\nDTSTART:20261005T100000Z\nDTEND:20261005T110000Z\nRRULE:FREQ=WEEKLY;UNTIL=20261019T235959Z");
    expect(busy(until)).toHaveLength(3);

    const interval = wrap(
      "UID:a\nDTSTART:20261005T100000Z\nDTEND:20261005T110000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3\nEXDATE:20261019T100000Z",
    );
    expect(busy(interval)).toEqual([
      "2026-10-05T10:00:00.000Z 2026-10-05T11:00:00.000Z",
      "2026-11-02T10:00:00.000Z 2026-11-02T11:00:00.000Z",
    ]);
  });

  it("expands monthly rules by weekday position and by month day", () => {
    const secondTuesday = wrap("UID:a\nDTSTART:20260908T100000Z\nDTEND:20260908T110000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU");
    expect(busy(secondTuesday)).toEqual([
      "2026-10-13T10:00:00.000Z 2026-10-13T11:00:00.000Z",
      "2026-11-10T10:00:00.000Z 2026-11-10T11:00:00.000Z",
    ]);
    const lastDay = wrap("UID:a\nDTSTART:20260930T100000Z\nDTEND:20260930T110000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(busy(lastDay)).toEqual([
      "2026-10-31T10:00:00.000Z 2026-10-31T11:00:00.000Z",
      "2026-11-30T10:00:00.000Z 2026-11-30T11:00:00.000Z",
    ]);
  });

  it("lets a moved occurrence replace the one in its series", () => {
    const ics = wrap(
      "UID:a\nDTSTART:20261005T100000Z\nDTEND:20261005T110000Z\nRRULE:FREQ=WEEKLY;COUNT=2",
      "UID:a\nRECURRENCE-ID:20261012T100000Z\nDTSTART:20261012T150000Z\nDTEND:20261012T160000Z",
    );
    expect(busy(ics)).toEqual([
      "2026-10-05T10:00:00.000Z 2026-10-05T11:00:00.000Z",
      "2026-10-12T15:00:00.000Z 2026-10-12T16:00:00.000Z",
    ]);
  });

  it("merges overlapping events and maps Outlook zone names", () => {
    const ics = wrap(
      "UID:a\nDTSTART:20261012T100000Z\nDTEND:20261012T110000Z",
      "UID:b\nDTSTART;TZID=W. Europe Standard Time:20261012T123000\nDTEND;TZID=W. Europe Standard Time:20261012T140000",
    );
    expect(busy(ics)).toEqual(["2026-10-12T10:00:00.000Z 2026-10-12T12:00:00.000Z"]);
  });
});

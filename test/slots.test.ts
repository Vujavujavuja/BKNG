import { describe, expect, it } from "vitest";
import { computeSlots, zonedTimeToUtc, type SlotRules } from "../src/lib/slots";

const HOUR = 3_600_000;
const iso = (ts: number) => new Date(ts).toISOString();

const rules: SlotRules = {
  timezone: "Europe/Belgrade",
  weeklyHours: {
    1: [{ start: "09:00", end: "12:00" }],
    2: [{ start: "09:00", end: "12:00" }],
    3: [{ start: "09:00", end: "12:00" }],
    4: [{ start: "09:00", end: "12:00" }],
    5: [{ start: "09:00", end: "12:00" }],
  },
  durationMinutes: 30,
  slotStepMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 60,
};

// Monday 12 Oct 2026, Belgrade is UTC+2 (summer time).
const monday = Date.UTC(2026, 9, 12);
const now = Date.UTC(2026, 9, 10);

describe("zonedTimeToUtc", () => {
  it("converts summer and winter wall-clock times", () => {
    expect(iso(zonedTimeToUtc(2026, 10, 12, 9, 0, "Europe/Belgrade"))).toBe("2026-10-12T07:00:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 10, 26, 9, 0, "Europe/Belgrade"))).toBe("2026-10-26T08:00:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 1, 5, 9, 0, "America/New_York"))).toBe("2026-01-05T14:00:00.000Z");
  });
});

describe("computeSlots", () => {
  it("returns every slot in an open day", () => {
    const slots = computeSlots(rules, [], monday, monday + 24 * HOUR, now);
    expect(slots.map(iso)).toEqual([
      "2026-10-12T07:00:00.000Z",
      "2026-10-12T07:30:00.000Z",
      "2026-10-12T08:00:00.000Z",
      "2026-10-12T08:30:00.000Z",
      "2026-10-12T09:00:00.000Z",
      "2026-10-12T09:30:00.000Z",
    ]);
  });

  it("skips days with no hours", () => {
    const saturday = Date.UTC(2026, 9, 17);
    expect(computeSlots(rules, [], saturday, saturday + 48 * HOUR, now)).toEqual([]);
  });

  it("removes slots that overlap busy time", () => {
    const busy = [{ start: Date.UTC(2026, 9, 12, 7, 15), end: Date.UTC(2026, 9, 12, 8, 0) }];
    const slots = computeSlots(rules, busy, monday, monday + 24 * HOUR, now);
    expect(slots.map(iso)).toEqual([
      "2026-10-12T08:00:00.000Z",
      "2026-10-12T08:30:00.000Z",
      "2026-10-12T09:00:00.000Z",
      "2026-10-12T09:30:00.000Z",
    ]);
  });

  it("applies buffers around busy time", () => {
    const busy = [{ start: Date.UTC(2026, 9, 12, 8, 0), end: Date.UTC(2026, 9, 12, 8, 30) }];
    const buffered = { ...rules, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 };
    const slots = computeSlots(buffered, busy, monday, monday + 24 * HOUR, now);
    expect(slots.map(iso)).toEqual(["2026-10-12T07:00:00.000Z", "2026-10-12T09:00:00.000Z", "2026-10-12T09:30:00.000Z"]);
  });

  it("enforces minimum notice and the booking horizon", () => {
    const lateNow = Date.UTC(2026, 9, 12, 6, 0);
    const noticed = { ...rules, minNoticeMinutes: 180 };
    const slots = computeSlots(noticed, [], monday, monday + 24 * HOUR, lateNow);
    expect(slots.map(iso)).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-12T09:30:00.000Z"]);

    const short = { ...rules, maxDaysAhead: 1 };
    expect(computeSlots(short, [], monday, monday + 24 * HOUR, now)).toEqual([]);
  });

  it("lets a date override replace or block a day", () => {
    const custom = { ...rules, dateOverrides: { "2026-10-12": [{ start: "14:00", end: "15:00" }], "2026-10-13": [] } };
    const slots = computeSlots(custom, [], monday, monday + 48 * HOUR, now);
    expect(slots.map(iso)).toEqual(["2026-10-12T12:00:00.000Z", "2026-10-12T12:30:00.000Z"]);
  });

  it("closes a day once the daily limit is reached", () => {
    const capped = { ...rules, maxPerDay: 2 };
    const booked = [Date.UTC(2026, 9, 12, 7, 0), Date.UTC(2026, 9, 12, 8, 0)];
    expect(computeSlots(capped, [], monday, monday + 24 * HOUR, now, booked)).toEqual([]);
    expect(computeSlots(capped, [], monday, monday + 24 * HOUR, now, booked.slice(1))).toHaveLength(6);
  });

  it("keeps wall-clock hours across the autumn DST change", () => {
    // Clocks go back on Sunday 25 Oct 2026; Monday 26th is UTC+1.
    const after = Date.UTC(2026, 9, 26);
    const slots = computeSlots(rules, [], after, after + 24 * HOUR, now);
    expect(iso(slots[0]!)).toBe("2026-10-26T08:00:00.000Z");
    expect(slots).toHaveLength(6);
  });
});

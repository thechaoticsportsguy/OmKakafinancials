const zone = "America/New_York";
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
export type Session = "premarket" | "regular" | "after-hours" | "overnight" | "closed";
export const sessionNames: Record<Session, string> = {
  premarket: "Premarket", regular: "Regular session", "after-hours": "After hours", overnight: "Overnight", closed: "Market closed",
};

export function eastern(at: number) {
  const formatted = Object.fromEntries(parts.formatToParts(at).map(({ type, value }) => [type, value]));
  const date = [formatted.year, formatted.month, formatted.day].join("-");
  const minutes = Number(formatted.hour) * 60 + Number(formatted.minute);
  return { date, minutes, seconds: Number(formatted.second) };
}

export function easternTime(date: string, minutes: number) {
  const target = Date.parse(date + "T00:00:00Z") + minutes * 60_000;
  const guess = target + 5 * 3_600_000;
  const local = eastern(guess);
  const represented = Date.parse(local.date + "T00:00:00Z") + local.minutes * 60_000;
  return guess + target - represented;
}

export function offsetDate(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

const earlyCloses = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24",
  "2027-11-26", "2028-07-03", "2028-11-24"]);
const specialClosures = new Set(["2018-12-05", "2025-01-09"]);

function weekday(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

function nthWeekday(year: number, month: string, day: number, nth: number) {
  const first = year + "-" + month + "-01";
  return offsetDate(first, (day - weekday(first) + 7) % 7 + (nth - 1) * 7);
}

function observed(date: string, observeSaturday = true) {
  if (weekday(date) === 6 && observeSaturday) return offsetDate(date, -1);
  if (weekday(date) === 0) return offsetDate(date, 1);
  return date;
}

function goodFriday(year: number) {
  const golden = year % 19;
  const century = Math.floor(year / 100);
  const remainder = year % 100;
  const leap = Math.floor(century / 4);
  const lunar = (19 * golden + century - leap - Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3) + 15) % 30;
  const solar = (32 + 2 * (century % 4) + 2 * Math.floor(remainder / 4) - lunar - (remainder % 4)) % 7;
  const correction = Math.floor((golden + 11 * lunar + 22 * solar) / 451);
  const calendar = lunar + solar - 7 * correction + 114;
  const month = Math.floor(calendar / 31);
  const day = calendar % 31 + 1;
  return offsetDate(year + "-0" + month + "-" + String(day).padStart(2, "0"), -2);
}

const holidays = new Map<number, Set<string>>();
function getHolidays(year: number) {
  const cached = holidays.get(year);
  if (cached) return cached;
  const dates = new Set([
    observed(year + "-01-01", false), nthWeekday(year, "01", 1, 3), nthWeekday(year, "02", 1, 3),
    goodFriday(year), offsetDate(nthWeekday(year, "06", 1, 1), -7), observed(year + "-07-04"),
    nthWeekday(year, "09", 1, 1), nthWeekday(year, "11", 4, 4), observed(year + "-12-25"),
  ]);
  if (year >= 2022) dates.add(observed(year + "-06-19"));
  holidays.set(year, dates);
  return dates;
}

export function tradingDay(date: string) {
  const day = weekday(date);
  return Number.isFinite(day) && day !== 0 && day !== 6
    && !specialClosures.has(date) && !getHolidays(Number(date.slice(0, 4))).has(date);
}

export const REGULAR_OPEN = 570;
export function regularClose(date: string) {
  const year = Number(date.slice(0, 4));
  if (year >= 2025 && year <= 2028) return earlyCloses.has(date) ? 780 : 960;
  const thanksgiving = nthWeekday(year, "11", 4, 4);
  return date === offsetDate(thanksgiving, 1) || date.endsWith("-12-24") || date.endsWith("-07-03") ? 780 : 960;
}

export function marketClock(at: number) {
  const { date, minutes } = eastern(at);
  const scheduled = tradingDay(date);
  const close = regularClose(date);
  let session: Session = "closed";
  if (scheduled && minutes >= 240 && minutes < (close === 780 ? 1020 : 1200)) {
    session = minutes < REGULAR_OPEN ? "premarket" : minutes < close ? "regular" : "after-hours";
  } else if ((minutes < 240 && scheduled) || (minutes >= 1200 && tradingDay(offsetDate(date, 1)))) {
    session = "overnight";
  }
  return { date, session, scheduled, close, minutes };
}

export function lastRegularDate(at: number) {
  const { date, scheduled, minutes } = marketClock(at);
  if (scheduled && minutes >= REGULAR_OPEN) return date;
  let previous = offsetDate(date, -1);
  while (!tradingDay(previous)) previous = offsetDate(previous, -1);
  return previous;
}

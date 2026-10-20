export type MarketSession = "pre" | "regular" | "after" | "closed";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function easternParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday as string,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

const isWeekend = (weekday: string) => weekday === "Sat" || weekday === "Sun";

/**
 * US equity session at `d`: pre 04:00-09:30, regular 09:30-16:00, after 16:00-20:00 Eastern, otherwise closed.
 * Weekends are closed. Exchange holidays are not known here; use `eventTradingDate` with a trading-day predicate.
 */
export function marketSession(d: Date): MarketSession {
  const { weekday, minutes } = easternParts(d);
  if (isWeekend(weekday)) return "closed";
  if (minutes >= 240 && minutes < 570) return "pre";
  if (minutes >= 570 && minutes < 960) return "regular";
  if (minutes >= 960 && minutes < 1200) return "after";
  return "closed";
}

function addDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

const weekdayTradingDay = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

/**
 * The trading date whose price first reflects the article: the same date for pre-market and regular-session
 * articles on a trading day, otherwise the next trading day. This is t0 for event studies.
 */
export function eventTradingDate(
  d: Date,
  isTradingDay: (date: string) => boolean = weekdayTradingDay,
): string {
  const { date } = easternParts(d);
  const session = marketSession(d);
  if ((session === "pre" || session === "regular") && isTradingDay(date)) return date;
  let next = addDay(date);
  // Bounded search so a faulty predicate cannot loop forever.
  for (let i = 0; i < 10 && !isTradingDay(next); i++) next = addDay(next);
  return next;
}

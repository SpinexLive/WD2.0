export const CALENDAR_TIME_ZONE = "Europe/London";

export const HOLIDAY_LOGOS = [
  { key: "newyear", label: "New Year", image: "/images/calendar logos/newyear.png", startDate: "2026-12-31", endDate: "2027-01-02" },
  { key: "remembrance", label: "Remembrance Sunday", image: "/images/calendar logos/remembrance.png", startDate: "2026-11-08", endDate: "2026-11-08" },
  { key: "st-patricks", label: "St Patrick's Day", image: "/images/calendar logos/st patricks.png", startDate: "2027-03-17", endDate: "2027-03-17" },
  { key: "halloween", label: "Halloween", image: "/images/calendar logos/halloween.png", startDate: "2027-10-31", endDate: "2027-10-31" },
  { key: "easter", label: "Easter", image: "/images/calendar logos/easter.png", startDate: "2027-03-26", endDate: "2027-03-29" },
  { key: "christmas", label: "Christmas", image: "/images/calendar logos/christmas.png", startDate: "2026-12-01", endDate: "2026-12-31" },
] as const;

export type HolidayLogoKey = (typeof HOLIDAY_LOGOS)[number]["key"];
export type CalendarIconVariant = HolidayLogoKey | "matchday" | "default";

export function londonDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatLondonDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatHolidayDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatLondonDate(startDate);
  return `${formatLondonDate(startDate)} - ${formatLondonDate(endDate)}`;
}

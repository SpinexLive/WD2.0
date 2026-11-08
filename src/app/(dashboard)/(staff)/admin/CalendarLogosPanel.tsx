import Image from "next/image";
import { formatHolidayDateRange, HOLIDAY_LOGOS } from "@/lib/calendarLogos";

const holidayAssets = new Set<string>(HOLIDAY_LOGOS.map((logo) => logo.image));

export default function CalendarLogosPanel() {
  const logos = [
    { key: "default", label: "Default", image: "/images/icon.png", dates: "Used outside scheduled logo dates" },
    { key: "matchday", label: "Match day", image: "/images/calendar logos/matchday.png", dates: "WDL match day: 01:00 London time until one hour after the latest match start" },
    ...HOLIDAY_LOGOS.map((logo) => ({
      key: logo.key,
      label: logo.label,
      image: logo.image,
      dates: formatHolidayDateRange(logo.startDate, logo.endDate),
    })),
  ];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-bold">Server calendar logos</h2>
        <p className="mt-1 text-sm text-stone/60">
          The bot updates the Discord server icon automatically. Date ranges use Europe/London and include both endpoints.
          One-day holiday logos override match day; match day overrides multi-day holiday logos. New Year takes priority over Christmas on 31 December.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {logos.map((logo) => (
          <article key={logo.key} className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/50 p-3">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-ink-800">
              <Image src={logo.image} alt={`${logo.label} server logo`} fill sizes="80px" className="object-contain" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold">{logo.label}</h3>
              <p className="mt-1 text-sm text-stone/65">{logo.dates}</p>
              {holidayAssets.has(logo.image) && <p className="mt-1 truncate text-xs text-stone/40">{logo.image}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function gwlMapLabel(map: string): string {
  return map.trim().toLowerCase() === "north-america" ? "Zestafona" : map;
}

export function gwlWeatherLabel(weather: string | null | undefined): string {
  if (weather === undefined) return "Unknown";
  if (weather === null || !weather.trim()) return "Any";
  return weather.trim().replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

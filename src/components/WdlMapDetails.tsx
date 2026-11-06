import React from "react";
import { parseWdlMap } from "@/lib/wdlFixtures";

export function WdlMapDetails({ value }: { value: string | null }) {
  const { map, zone, weather } = parseWdlMap(value);
  return <span>Map: {map ?? "TBC"} · Zone: {zone ?? "TBC"} · Weather: {weather ?? "TBC"}</span>;
}

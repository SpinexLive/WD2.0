import React from "react";
import type { GwlMemberStatus } from "@/lib/gwlMemberStatus";
type Props = { league: "GWL"; status: GwlMemberStatus };

export function RosterLeagueMark(props: Props) {
  const { league, status } = props;
  const confirmed = status === "linked";
  const detail = status === "linked" ? "Linked by Discord ID"
    : status === "not_matched" ? "Not matched by Discord ID; this does not prove the player is unregistered"
    : "Unknown";
  const label = `${league}: ${detail}`;
  const color = confirmed ? "border-ok/40 text-ok" : "border-blood-500/50 text-blood-300";
  return <span role="img" aria-label={label} title={label} className={`shrink-0 rounded border px-1 text-[10px] font-semibold ${color}`}>{league}</span>;
}

import React from "react";
import type { GwlMemberStatus } from "@/lib/gwlMemberStatus";
import type { RegistrationStatus } from "@/lib/rosterTypes";

type Props = { league: "GWL"; status: GwlMemberStatus } | { league: "WDL"; status: RegistrationStatus };

export function RosterLeagueMark(props: Props) {
  const { league, status } = props;
  const confirmed = status === "linked" || status === "registered";
  const pending = status === "pending";
  const detail = status === "linked" ? "Linked by Discord ID"
    : status === "not_matched" ? "Not matched by Discord ID; this does not prove the player is unregistered"
    : status === "registered" ? "Registered"
    : status === "not_registered" ? "Not registered"
    : pending ? "Application pending" : "Unknown";
  const label = `${league}: ${detail}`;
  const color = confirmed ? "border-ok/40 text-ok" : pending ? "border-warn/40 text-warn" : "border-blood-500/50 text-blood-300";
  return <span role="img" aria-label={label} title={label} className={`shrink-0 rounded border px-1 text-[10px] font-semibold ${color}`}>{league}</span>;
}

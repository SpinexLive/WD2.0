import React from "react";
import { FACTIONS, resolveFaction } from "@/lib/scouting";
import type { WdlFixture } from "@/lib/wdlFixtures";

export function WdlParticipants({ participants, result = false }: { participants: WdlFixture["participants"]; result?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone/70">
      {participants.map((participant, index) => {
        const faction = resolveFaction(participant.faction);
        const icon = faction ? FACTIONS[faction].image : null;
        return (
          <span key={`${participant.team.code ?? participant.team.name ?? "team"}-${index}`} className="inline-flex items-center gap-1">
            {icon && /* eslint-disable-next-line @next/next/no-img-element */ <img src={icon} alt="" width={24} height={24} className="h-6 w-6 shrink-0 object-contain" />}
            <span>
              {participant.team.code || participant.team.name || "Team TBC"}: {participant.faction ?? "Faction TBC"}
              {result && participant.finishingPosition !== null ? ` · Position ${participant.finishingPosition}` : ""}
              {result && participant.points !== null ? ` · ${participant.points} points` : ""}
              {result && participant.noShow === true ? " · No show" : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}

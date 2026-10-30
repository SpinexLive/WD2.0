import { requestJson } from "@/lib/http";
import { handleRosterButton, type ButtonInteraction } from "./rosterResponses";

export interface DeferredRosterInteraction extends ButtonInteraction {
  application_id: string;
  token: string;
}

/** Finish an HTTP button interaction after its immediate deferred acknowledgement. */
export async function finishRosterInteraction(interaction: DeferredRosterInteraction): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`;
  let result: { type: number; data: Record<string, unknown> };
  try {
    result = await handleRosterButton(interaction) as typeof result;
  } catch {
    result = { type: 4, data: { content: "Something went wrong. Please try again.", flags: 64 } };
  }
  try {
    await requestJson({
      provider: "discord",
      method: result.type === 7 ? "PATCH" : "POST",
      url: result.type === 7 ? `${url}/messages/@original` : url,
      body: { ...result.data, allowed_mentions: { parse: [] } },
      retries: 0,
    });
  } catch {
    // Never log interaction webhook URLs: they contain a temporary credential.
    console.error("Could not deliver deferred roster interaction result");
  }
}

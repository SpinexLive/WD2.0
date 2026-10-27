import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { teamKey } from "@/lib/scouting";
import { deleteMessage, editMessage, hasAuthorisedRole, postMessage } from "./discord";
import { getEvents } from "./raidHelper";
import { saveObservation, type Fields } from "./scouting";

export const FEEDBACK_BUTTON = "wdfb";
export const FEEDBACK_MODAL = "wdfbm";
const RED = 0x8b1a1a;

interface EventRow {
  event_id: string;
  title: string;
  team_a: string;
  team_b: string;
  closed_at: Date | null;
  prompt_channel_id: string | null;
  prompt_message_id: string | null;
}

async function loadEvent(eventId: string): Promise<EventRow | null> {
  const [r] = await query<EventRow>("SELECT event_id, title, team_a, team_b, closed_at, prompt_channel_id, prompt_message_id FROM scouting_events WHERE event_id = $1", [eventId]);
  return r ?? null;
}

function promptPayload(e: EventRow, open: boolean) {
  const base = env().APP_URL.replace(/\/+$/, "");
  return {
    embeds: [
      {
        title: "Match feedback",
        description: open
          ? `How did **${e.title}** go?\nPick the team you want to give feedback on. It's anonymous to reviewers, and you can edit it later.`
          : `Feedback for **${e.title}** is now closed. Thanks to everyone who contributed.`,
        color: RED,
        fields: open ? [{ name: "Opposing teams", value: `${e.team_a}\n${e.team_b}` }] : [],
      },
    ],
    components: open
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 2, label: `Feedback: ${e.team_a}`.slice(0, 80), custom_id: `${FEEDBACK_BUTTON}:${e.event_id}:a` },
              { type: 2, style: 2, label: `Feedback: ${e.team_b}`.slice(0, 80), custom_id: `${FEEDBACK_BUTTON}:${e.event_id}:b` },
              { type: 2, style: 5, label: "Open dashboard", url: `${base}/observe` },
            ],
          },
        ]
      : [],
    allowed_mentions: { parse: [] as never[] },
  };
}

/** Posts (or reposts) the feedback prompt in the channel where the Raid Helper sign-up lives. */
export async function postFeedbackPrompt(eventId: string): Promise<{ channelId: string }> {
  const e = await loadEvent(eventId);
  if (!e || e.closed_at) throw new HttpError(409, "Open the match for feedback first", "not_open");
  const event = (await getEvents().then((s) => s.data)).find((x) => x.id === eventId);
  if (!event?.channelId) throw new HttpError(400, "Raid Helper didn't report a channel for this event, so there is nowhere to post.", "no_channel");
  const messageId = await postMessage(event.channelId, promptPayload(e, true));
  if (e.prompt_channel_id && e.prompt_message_id) await deleteMessage(e.prompt_channel_id, e.prompt_message_id).catch(() => undefined);
  await query("UPDATE scouting_events SET prompt_channel_id = $2, prompt_message_id = $3 WHERE event_id = $1", [eventId, event.channelId, messageId]);
  return { channelId: event.channelId };
}

/** Swaps the buttons for a "closed" notice once feedback is closed. Best effort. */
export async function closeFeedbackPrompt(eventId: string): Promise<void> {
  const e = await loadEvent(eventId);
  if (!e?.prompt_channel_id || !e.prompt_message_id) return;
  await editMessage(e.prompt_channel_id, e.prompt_message_id, promptPayload(e, false)).catch(() => undefined);
}

/** Posts the cached AI overview for a team as an embed in the scouting channel. */
export async function postOverview(key: string): Promise<{ channelId: string }> {
  const [s] = await query<{ team_name: string; summary: string; obs_count: number; generated_at: Date }>("SELECT team_name, summary, obs_count, generated_at FROM scouting_summaries WHERE team_key = $1", [key]);
  if (!s) throw new HttpError(404, "Generate an overview for this team first", "no_summary");
  const [m] = await query<{ n: string }>("SELECT count(DISTINCT event_id) AS n FROM scouting_observations WHERE team_key = $1", [key]);
  const channelId = env().SCOUTING_CHANNEL_ID;
  await postMessage(channelId, {
    embeds: [
      {
        title: `Scouting report: ${s.team_name}`.slice(0, 256),
        description: s.summary.slice(0, 4000),
        color: RED,
        footer: { text: `AI-generated from ${s.obs_count} note${s.obs_count === 1 ? "" : "s"} across ${Number(m?.n ?? 0)} match${Number(m?.n) === 1 ? "" : "es"}` },
        timestamp: s.generated_at.toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  });
  return { channelId };
}

type Member = ButtonInteraction["member"];

function bypassRoles(member: Member): boolean {
  if (!member) return false;
  const roles = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
  return hasAuthorisedRole(roles) || roles.includes(env().DISCORD_REVIEWER_ROLE_ID);
}

async function canGive(eventId: string, userId: string, bypass: boolean): Promise<boolean> {
  if (bypass) return true;
  const [r] = await query<{ ok: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM rosters r JOIN roster_assignments a ON a.roster_id = r.id AND a.discord_id = $2 WHERE r.raid_helper_event_id = $1) AS ok",
    [eventId, userId],
  );
  return !!r?.ok;
}

function parseId(customId: string): { eventId: string; slot: "a" | "b" } | null {
  const [, eventId, slot] = customId.split(":");
  return eventId && (slot === "a" || slot === "b") ? { eventId, slot } : null;
}

const SECTIONS: { id: keyof Fields; label: string; placeholder: string }[] = [
  { id: "overview", label: "Overview", placeholder: "General impression and playstyle" },
  { id: "strengths", label: "Strengths", placeholder: "What they did well" },
  { id: "weaknesses", label: "Weaknesses", placeholder: "Where they were vulnerable" },
  { id: "tactics", label: "Tactics to use against them", placeholder: "What we should do next time" },
];

export async function onFeedbackButton(i: ButtonInteraction): Promise<void> {
  const ref = parseId(i.customId);
  const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
  if (!ref || i.guildId !== env().DISCORD_GUILD_ID) return void (await reply("That feedback button isn't valid."));
  const e = await loadEvent(ref.eventId);
  if (!e || e.closed_at) return void (await reply("Feedback for this match is closed."));
  if (!(await canGive(ref.eventId, i.user.id, bypassRoles(i.member)))) return void (await reply("Only players on the roster for this match can give feedback."));

  const team = ref.slot === "a" ? e.team_a : e.team_b;
  const [mine] = await query<{ body: string; strengths: string; weaknesses: string; tactics: string }>(
    "SELECT body, strengths, weaknesses, tactics FROM scouting_observations WHERE event_id = $1 AND team_key = $2 AND author_id = $3",
    [ref.eventId, teamKey(team), i.user.id],
  );
  const existing: Fields = { overview: mine?.body ?? "", strengths: mine?.strengths ?? "", weaknesses: mine?.weaknesses ?? "", tactics: mine?.tactics ?? "" };
  const modal = new ModalBuilder().setCustomId(`${FEEDBACK_MODAL}:${ref.eventId}:${ref.slot}`).setTitle(`Feedback: ${team}`.slice(0, 45));
  for (const s of SECTIONS) {
    const input = new TextInputBuilder().setCustomId(s.id).setLabel(s.label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setPlaceholder(s.placeholder);
    if (existing[s.id]) input.setValue(existing[s.id]);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  await i.showModal(modal);
}

export async function onFeedbackModal(i: ModalSubmitInteraction): Promise<void> {
  const ref = parseId(i.customId);
  if (!ref || i.guildId !== env().DISCORD_GUILD_ID) return void (await i.reply({ content: "That form isn't valid.", flags: MessageFlags.Ephemeral }));
  try {
    const fields = Object.fromEntries(SECTIONS.map((s) => [s.id, i.fields.getTextInputValue(s.id)])) as unknown as Fields;
    await saveObservation(ref.eventId, ref.slot, i.user.id, fields, bypassRoles(i.member));
    await i.reply({ content: "Thanks, your feedback was saved. You can press the button again to edit it.", flags: MessageFlags.Ephemeral });
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : "Something went wrong. Please try again.";
    await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

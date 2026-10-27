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

const memberRoles = (member: Member): string[] => (!member ? [] : Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()]);

function bypassRoles(roles: string[]): boolean {
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

interface FormSpec {
  customId: string;
  title: string;
  fields: { id: keyof Fields; label: string; placeholder: string; value: string }[];
}

/** Shared by the gateway and the HTTP interactions endpoint: either an error message or the form to show. */
export async function prepareForm(customId: string, guildId: string | null | undefined, userId: string, roles: string[]): Promise<{ error: string } | { form: FormSpec }> {
  const ref = parseId(customId);
  if (!ref || guildId !== env().DISCORD_GUILD_ID) return { error: "That feedback button isn't valid." };
  const e = await loadEvent(ref.eventId);
  if (!e || e.closed_at) return { error: "Feedback for this match is closed." };
  if (!(await canGive(ref.eventId, userId, bypassRoles(roles)))) return { error: "Only players on the roster for this match can give feedback." };

  const team = ref.slot === "a" ? e.team_a : e.team_b;
  const [mine] = await query<{ body: string; strengths: string; weaknesses: string; tactics: string }>(
    "SELECT body, strengths, weaknesses, tactics FROM scouting_observations WHERE event_id = $1 AND team_key = $2 AND author_id = $3",
    [ref.eventId, teamKey(team), userId],
  );
  const existing: Fields = { overview: mine?.body ?? "", strengths: mine?.strengths ?? "", weaknesses: mine?.weaknesses ?? "", tactics: mine?.tactics ?? "" };
  return {
    form: {
      customId: `${FEEDBACK_MODAL}:${ref.eventId}:${ref.slot}`,
      title: `Feedback: ${team}`.slice(0, 45),
      fields: SECTIONS.map((s) => ({ id: s.id, label: s.label.slice(0, 45), placeholder: s.placeholder, value: existing[s.id] })),
    },
  };
}

/** Saves a submitted form and returns the message to show the player. */
export async function submitForm(customId: string, guildId: string | null | undefined, userId: string, roles: string[], values: Partial<Fields>): Promise<string> {
  const ref = parseId(customId);
  if (!ref || guildId !== env().DISCORD_GUILD_ID) return "That form isn't valid.";
  try {
    const f: Fields = { overview: values.overview ?? "", strengths: values.strengths ?? "", weaknesses: values.weaknesses ?? "", tactics: values.tactics ?? "" };
    await saveObservation(ref.eventId, ref.slot, userId, f, bypassRoles(roles));
    return "Thanks, your feedback was saved. You can press the button again to edit it.";
  } catch (err) {
    return err instanceof HttpError ? err.message : "Something went wrong. Please try again.";
  }
}

export async function onFeedbackButton(i: ButtonInteraction): Promise<void> {
  const r = await prepareForm(i.customId, i.guildId, i.user.id, memberRoles(i.member));
  if ("error" in r) return void (await i.reply({ content: r.error, flags: MessageFlags.Ephemeral }));
  const modal = new ModalBuilder().setCustomId(r.form.customId).setTitle(r.form.title);
  for (const f of r.form.fields) {
    const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setPlaceholder(f.placeholder);
    if (f.value) input.setValue(f.value);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  await i.showModal(modal);
}

export async function onFeedbackModal(i: ModalSubmitInteraction): Promise<void> {
  const values = Object.fromEntries(SECTIONS.map((s) => [s.id, i.fields.getTextInputValue(s.id)]));
  const msg = await submitForm(i.customId, i.guildId, i.user.id, memberRoles(i.member), values);
  await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

interface RawInteraction {
  type?: number;
  guild_id?: string;
  member?: { user?: { id?: string }; roles?: string[] };
  user?: { id?: string };
  data?: { custom_id?: string; components?: { components?: { custom_id?: string; value?: string }[] }[] };
}

const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

/** HTTP Interactions Endpoint variant: returns the raw response body for a feedback button (type 3) or form submit (type 5). */
export async function handleFeedbackRaw(i: RawInteraction): Promise<unknown> {
  const userId = i.member?.user?.id ?? i.user?.id;
  const customId = i.data?.custom_id ?? "";
  const roles = i.member?.roles ?? [];
  if (!userId) return ephemeral("That feedback button isn't valid.");
  if (i.type === 5) {
    const values: Record<string, string> = {};
    for (const row of i.data?.components ?? []) for (const c of row.components ?? []) if (c.custom_id) values[c.custom_id] = c.value ?? "";
    return ephemeral(await submitForm(customId, i.guild_id, userId, roles, values));
  }
  const r = await prepareForm(customId, i.guild_id, userId, roles);
  if ("error" in r) return ephemeral(r.error);
  return {
    type: 9,
    data: {
      custom_id: r.form.customId,
      title: r.form.title,
      components: r.form.fields.map((f) => ({
        type: 1,
        components: [{ type: 4, custom_id: f.id, style: 2, label: f.label, required: false, max_length: 2000, placeholder: f.placeholder, ...(f.value ? { value: f.value } : {}) }],
      })),
    },
  };
}

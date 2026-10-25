import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy | REMNANT" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="25 October 2026">
      <section>
        <p>This site is run by REMNANT, a gaming community. This policy explains what we collect and why. You can browse the public pages without signing in or giving us any information.</p>
      </section>
      <section>
        <h2>Signing in with Discord</h2>
        <p>The clan dashboard is for REMNANT officers. When an officer signs in with Discord we receive their Discord ID, username, avatar and the roles they hold in the REMNANT server. We use these only to check they are allowed in and to show who they are. We never see or store your Discord password.</p>
      </section>
      <section>
        <h2>What we store</h2>
        <ul>
          <li>Discord ID, username and avatar of signed-in officers, and a record of actions they take (for example responding to applications or publishing rosters).</li>
          <li>Clan roster data: Discord names and avatars, Steam IDs, game statistics and tournament registration status for clan members.</li>
          <li>A secure session cookie that keeps an officer signed in. It is not used for tracking or advertising.</li>
          <li>Your IP address, kept briefly to limit abuse and rate-limit requests.</li>
        </ul>
      </section>
      <section>
        <h2>Public pages</h2>
        <p>The home page shows upcoming events, clan news, game server status and Discord users currently in our voice channels (display names and avatars, as shown by Discord's public server widget). If you would prefer not to appear, leave voice or ask an officer.</p>
      </section>
      <section>
        <h2>Third parties</h2>
        <p>We use Discord (sign-in and server data), Raid Helper (event sign-ups), Wardogs League and Wardogs RCON (tournament and game server data). Each has its own privacy policy. We do not sell your data or use advertising or analytics trackers.</p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>You can ask us to remove or correct your data at any time by contacting an officer in the REMNANT Discord server. You can also revoke this site's access under Discord's Settings, Authorized Apps.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>We may update this policy and will change the date above when we do.</p>
      </section>
    </LegalPage>
  );
}

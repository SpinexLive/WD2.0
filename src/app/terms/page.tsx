import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms & Conditions | REMNANT" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms &amp; Conditions" updated="25 October 2026">
      <section>
        <p>By using this website you agree to these terms. This is the official website of REMNANT, a gaming community, and is not affiliated with or endorsed by Discord, Raid Helper, Wardogs League, Wardogs RCON or the makers of Hell Let Loose.</p>
      </section>
      <section>
        <h2>Using the site</h2>
        <p>The public pages are free to view. The dashboard is a private tool for authorised REMNANT officers. Access is granted by Discord role and can be removed at any time. You must not try to gain access you have not been given, disrupt the site or misuse its services.</p>
      </section>
      <section>
        <h2>Accounts</h2>
        <p>Sign-in is handled by Discord. You are responsible for keeping your Discord account secure and for actions taken with it on this site.</p>
      </section>
      <section>
        <h2>Joining the clan</h2>
        <p>Applications are made through our Discord server. Membership is at the discretion of REMNANT officers, and we expect members to be active, use voice comms and treat others with respect.</p>
      </section>
      <section>
        <h2>Content</h2>
        <p>News, branding and logos on this site belong to REMNANT. Game names and trademarks belong to their owners and are used only to describe what we play.</p>
      </section>
      <section>
        <h2>Availability and liability</h2>
        <p>The site and its live data (events, voice, server status) are provided as is and may be unavailable or out of date. To the extent the law allows, REMNANT is not liable for losses arising from using the site.</p>
      </section>
      <section>
        <h2>Privacy and changes</h2>
        <p>How we handle data is described in our <a href="/privacy" className="text-blood-300 underline">Privacy Policy</a>. We may update these terms at any time, and continued use means you accept the changes.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions? Ask an officer in the REMNANT Discord server.</p>
      </section>
    </LegalPage>
  );
}

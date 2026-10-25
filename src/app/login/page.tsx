import Image from "next/image";
import "./login.css";

// Fixed values keep server and client markup identical.
const EMBERS = [
  { x: "6%", s: "3px", d: "14s", delay: "0s" }, { x: "14%", s: "2px", d: "18s", delay: "4s" },
  { x: "23%", s: "4px", d: "16s", delay: "8s" }, { x: "31%", s: "2px", d: "20s", delay: "1s" },
  { x: "42%", s: "3px", d: "15s", delay: "6s" }, { x: "50%", s: "2px", d: "19s", delay: "10s" },
  { x: "58%", s: "4px", d: "17s", delay: "3s" }, { x: "66%", s: "3px", d: "21s", delay: "7s" },
  { x: "74%", s: "2px", d: "14s", delay: "11s" }, { x: "82%", s: "3px", d: "18s", delay: "2s" },
  { x: "90%", s: "2px", d: "16s", delay: "9s" }, { x: "96%", s: "4px", d: "20s", delay: "5s" },
];
const messages: Record<string, string> = {
  state: "Your login session expired or was invalid. Please try again.",
  cancelled: "Discord login was cancelled.",
  not_in_guild: "You are not a member of the REMNANT Discord server.",
  forbidden: "Your Discord account does not have a role that grants dashboard access.",
  discord_error: "Discord could not complete the login. Please try again shortly.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 p-4">
      <div className="login-bg" />
      <div className="login-vignette" />
      <div className="login-grain" />
      <div className="login-embers" aria-hidden="true">
        {EMBERS.map((e, i) => (
          <i key={i} style={{ "--x": e.x, "--s": e.s, "--d": e.d, "--delay": e.delay } as React.CSSProperties} />
        ))}
      </div>
      <div className="login-card card relative w-full max-w-sm bg-ink-900/90 p-8 text-center backdrop-blur">
        <Image src="/images/icon.png" alt="REMNANT" width={96} height={96} className="login-logo mx-auto" priority />
        <h1 className="login-title mt-2 text-2xl font-bold tracking-[0.3em] text-stone">REMNANT</h1>
        <div className="login-divider mx-auto mt-3 h-0.5 w-16 bg-blood-600" />
        {error && <p role="alert" className="mt-6 rounded-md border border-blood-700 bg-blood-700/20 p-3 text-sm">{messages[error] ?? "Login failed."}</p>}
        <a href="/api/auth/login" className="btn-primary login-btn mt-6 w-full gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
          Sign in with Discord
        </a>
      </div>
    </main>
  );
}

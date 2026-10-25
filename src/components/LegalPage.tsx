import Image from "next/image";
import Link from "next/link";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <header className="border-b border-ink-700/70 bg-ink-950/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/images/icon.png" alt="REMNANT" width={32} height={32} />
            <span className="text-lg font-bold tracking-[0.3em] text-stone">REMNANT</span>
          </Link>
          <Link href="/" className="btn-ghost">Back to home</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-extrabold text-stone">{title}</h1>
        <p className="mt-1 text-xs text-stone/50">Last updated {updated}</p>
        <div className="mt-6 space-y-6 text-sm leading-relaxed text-stone/75 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-stone [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      </main>
      <footer className="border-t border-ink-700/70 py-5 text-center text-xs text-stone/45">
        <Link href="/privacy" className="hover:text-stone">Privacy Policy</Link> · <Link href="/terms" className="hover:text-stone">Terms &amp; Conditions</Link>
        <div className="mt-1">© 2026 REMNANT. All rights reserved.</div>
      </footer>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton } from "@/components/ui";
import WhitelistPanel from "./WhitelistPanel";
import GoldPanel from "./GoldPanel";
import StatusPanel from "./StatusPanel";
import WdlRolePanel from "./WdlRolePanel";
import SeedingAfkPanel from "./SeedingAfkPanel";

interface Overview {
  audit: { id: string; actor: string | null; action: string; targetType: string | null; targetId: string | null; details: unknown; at: string }[];
}

type Tab = "whitelist" | "gold" | "wdl-role" | "seeding-afk" | "status" | "audit";

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

export default function AdminClient() {
  const api = useApi();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("whitelist");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Overview>("/api/admin/overview"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const tabs: [Tab, string][] = [["whitelist", "Whitelist links"], ["gold", "Gold price"], ["wdl-role", "WDL role"], ["seeding-afk", "Seeding AFK"], ["status", "Status"], ["audit", "Audit log"]];

  return (
    <div className="flex flex-col gap-4 md:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Admin</h1>
        <button className="btn-ghost" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="flex flex-wrap gap-1 border-b border-ink-700">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] ${tab === k ? "border-blood-500 text-stone" : "border-transparent text-stone/50 hover:text-stone"}`}>{label}</button>
        ))}
      </div>

      <section className="card min-h-64 flex-1 overflow-auto md:min-h-0">
        {tab === "whitelist" ? (
          <WhitelistPanel onChanged={load} />
        ) : tab === "gold" ? (
          <GoldPanel />
        ) : tab === "wdl-role" ? (
          <WdlRolePanel />
        ) : tab === "seeding-afk" ? (
          <SeedingAfkPanel />
        ) : tab === "status" ? (
          <StatusPanel />
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-ink-900"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Target</th><th className="th">Details</th></tr></thead>
            <tbody>
              {data?.audit.map((l) => (
                <tr key={l.id} className="border-t border-ink-700">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-stone/70">{fmt(l.at)}</td>
                  <td className="px-3 py-1.5 text-sm">{l.actor ?? "-"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{l.action}</td>
                  <td className="px-3 py-1.5 text-xs text-stone/70">{l.targetType ? `${l.targetType}${l.targetId ? ` ${l.targetId}` : ""}` : "-"}</td>
                  <td className="max-w-xs truncate px-3 py-1.5 font-mono text-xs text-stone/50" title={JSON.stringify(l.details)}>{JSON.stringify(l.details)}</td>
                </tr>
              ))}
              {data?.audit.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-stone/50">No audit entries.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

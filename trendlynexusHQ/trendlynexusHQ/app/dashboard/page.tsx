export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Dashboard() {
  const s = await getServerSession(authOptions);
  if (!s?.user?.id) redirect("/login");
  const u = await prisma.user.findUnique({
    where: { id: s.user.id },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      trendMetrics: { orderBy: { score: "desc" }, take: 10 },
    },
  });
  if (!u) redirect("/login");

  const sub = u.subscriptions[0];
  const isPaid = u.plan !== "FREE";

  return (
    <main className="min-h-screen">
      <nav className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="font-black">
            trendly<span className="text-cyan-300">nexus</span>HQ
          </div>
          <div className="flex gap-5 text-sm">
            <a href="/dashboard" className="text-cyan-300">Dashboard</a>
            <a href="/settings">Settings</a>
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="text-slate-400">Sign out</button>
            </form>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-cyan-300">CONTROL CENTER</p>
        <h1 className="mt-2 text-4xl font-black">Welcome, {u.name || u.email}</h1>
        <div className="mt-3 flex items-center gap-4">
          <span className="text-slate-500">Plan:</span>
          <span className={`rounded-lg px-3 py-1 text-sm font-bold ${isPaid ? "bg-cyan-300 text-slate-950" : "bg-white/10 text-slate-300"}`}>
            {u.plan}
          </span>
          {!isPaid && (
            <a href="/#pricing" className="text-sm text-cyan-300 underline">Upgrade →</a>
          )}
          {sub && (
            <span className="text-sm text-slate-500">
              {sub.cancelAtPeriodEnd ? "Cancels at period end" : `Renews ${sub.currentPeriodEnd?.toLocaleDateString()}`}
            </span>
          )}
        </div>

        <section className="mt-10 rounded-2xl border border-white/10 bg-white/[.03] p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Top trend signals</h2>
            <span className="text-sm text-slate-500">{u.trendMetrics.length} signals</span>
          </div>
          {u.trendMetrics.length === 0 ? (
            <div className="mt-5 rounded-xl border border-white/10 p-8 text-center">
              <p className="text-slate-400">No trend signals yet.</p>
              <p className="mt-2 text-sm text-slate-500">Trend data will appear here once your integrations are connected.</p>
              <a href="/settings" className="mt-4 inline-block rounded-xl border border-white/10 px-5 py-2 text-sm">Configure integrations →</a>
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4">Keyword</th>
                    <th className="p-4">Score</th>
                    <th className="p-4">Volume</th>
                    <th className="p-4">Momentum</th>
                    <th className="p-4">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {u.trendMetrics.map((t) => (
                    <tr className="border-t border-white/10" key={t.id}>
                      <td className="p-4 font-bold">{t.keyword}</td>
                      <td className="p-4">{t.score.toFixed(1)}</td>
                      <td className="p-4">{t.volume.toLocaleString()}</td>
                      <td className="p-4 text-cyan-300">+{t.momentum.toFixed(1)}%</td>
                      <td className="p-4 text-slate-400">{t.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isPaid && (
          <form action="/api/stripe/portal" method="post" className="mt-6">
            <button className="rounded-xl border border-white/10 px-5 py-3">Manage billing</button>
          </form>
        )}
      </div>
    </main>
  );
}

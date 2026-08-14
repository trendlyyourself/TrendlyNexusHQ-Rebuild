export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SettingsForm from "./SettingsForm";

export default async function Settings() {
  const s = await getServerSession(authOptions);
  if (!s?.user?.id) redirect("/login");
  const u = await prisma.user.findUnique({
    where: { id: s.user.id },
    include: { integrationSettings: true },
  });
  if (!u) redirect("/login");

  return (
    <main className="min-h-screen">
      <nav className="border-b border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-5 font-black">
          trendly<span className="text-cyan-300">nexus</span>HQ
        </div>
      </nav>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-cyan-300">SETTINGS</p>
        <h1 className="mt-2 text-4xl font-black">Integrations</h1>
        <p className="mt-2 text-slate-500">
          Connect your e-commerce and ad platforms to feed real data into your trend radar.
        </p>
        <SettingsForm
          initial={{
            shopDomain: u.integrationSettings?.shopDomain ?? "",
            shopifyOn: u.integrationSettings?.shopifyOn ?? false,
            metaOn: u.integrationSettings?.metaOn ?? false,
            googleOn: u.integrationSettings?.googleOn ?? false,
          }}
          userId={u.id}
        />
        <div className="mt-8 flex gap-4">
          <a href="/dashboard" className="rounded-xl border border-white/10 px-5 py-3 text-sm">
            ← Back to Dashboard
          </a>
          <form action="/api/auth/signout" method="post">
            <input type="hidden" name="csrfToken" value="" />
            <button type="submit" className="rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-400">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

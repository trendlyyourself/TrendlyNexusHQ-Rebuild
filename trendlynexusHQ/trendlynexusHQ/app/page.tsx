import Pricing from "@/components/Pricing";

export default function Home() {
  return (
    <main className="min-h-screen">
      <nav className="mx-auto flex max-w-6xl justify-between px-6 py-6">
        <b>trendly<span className="text-cyan-300">nexus</span>HQ</b>
        <div className="flex gap-5 text-sm">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="/login">Sign in</a>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-28 text-center">
        <p className="text-sm font-bold uppercase tracking-[.3em] text-cyan-300">Trend intelligence → action</p>
        <h1 className="mt-5 text-5xl font-black md:text-7xl">Find what is about to sell before everyone else does.</h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-slate-400">Turn market signals into product opportunities, content angles and e-commerce decisions from one operating system.</p>
        <a href="#pricing" className="mt-9 inline-block rounded-xl bg-cyan-300 px-7 py-4 font-black text-slate-950">View plans</a>
      </section>

      <section id="features" className="mx-auto grid max-w-6xl gap-5 px-6 py-12 md:grid-cols-3">
        {[
          ["Trend Radar", "Rank emerging keywords by score, volume and momentum."],
          ["Content Engine", "Turn opportunities into repeatable hooks and campaign angles."],
          ["Store Intelligence", "Connect market signals to products, channels and decisions."],
        ].map(([a, b]) => (
          <article className="rounded-2xl border border-white/10 bg-white/[.03] p-7" key={a}>
            <h2 className="text-xl font-bold">{a}</h2>
            <p className="mt-3 text-slate-400">{b}</p>
          </article>
        ))}
      </section>

      <Pricing />

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-10 text-center text-sm text-slate-500">
          <p>trendlynexusHQ — Trend intelligence, content generation and e-commerce analytics.</p>
          <p className="mt-2">© {new Date().getFullYear()} trendlynexusHQ. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

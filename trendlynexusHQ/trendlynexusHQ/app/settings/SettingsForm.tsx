"use client";
import { useState } from "react";

interface Props {
  initial: {
    shopDomain: string;
    shopifyOn: boolean;
    metaOn: boolean;
    googleOn: boolean;
  };
  userId: string;
}

export default function SettingsForm({ initial, userId }: Props) {
  const [shopDomain, setShopDomain] = useState(initial.shopDomain);
  const [shopifyOn, setShopifyOn] = useState(initial.shopifyOn);
  const [metaOn, setMetaOn] = useState(initial.metaOn);
  const [googleOn, setGoogleOn] = useState(initial.googleOn);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Saving...");
    const r = await fetch("/api/settings/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain, shopifyOn, metaOn, googleOn }),
    });
    setMsg(r.ok ? "Saved successfully." : "Failed to save.");
  }

  return (
    <form onSubmit={save} className="mt-8 space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-6">
        <h2 className="text-xl font-bold">Shopify</h2>
        <p className="mt-1 text-sm text-slate-400">Connect your store to sync product and sales data.</p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={shopifyOn} onChange={(e) => setShopifyOn(e.target.checked)} className="h-5 w-5" />
            <span>Enable Shopify integration</span>
          </label>
          {shopifyOn && (
            <input
              placeholder="your-store.myshopify.com"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3"
            />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-6">
        <h2 className="text-xl font-bold">Meta Ads</h2>
        <p className="mt-1 text-sm text-slate-400">Pull ad performance signals from Facebook & Instagram.</p>
        <label className="mt-4 flex items-center gap-3">
          <input type="checkbox" checked={metaOn} onChange={(e) => setMetaOn(e.target.checked)} className="h-5 w-5" />
          <span>Enable Meta Ads integration</span>
        </label>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-6">
        <h2 className="text-xl font-bold">Google Ads</h2>
        <p className="mt-1 text-sm text-slate-400">Pull search volume and ad performance from Google.</p>
        <label className="mt-4 flex items-center gap-3">
          <input type="checkbox" checked={googleOn} onChange={(e) => setGoogleOn(e.target.checked)} className="h-5 w-5" />
          <span>Enable Google Ads integration</span>
        </label>
      </div>

      {msg && <p className="text-sm text-cyan-200">{msg}</p>}
      <button type="submit" className="rounded-xl bg-cyan-300 px-6 py-3 font-bold text-slate-950">
        Save Settings
      </button>
    </form>
  );
}

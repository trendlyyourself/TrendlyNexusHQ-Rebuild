import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(r: Request) {
  const s = await getServerSession(authOptions);
  if (!s?.user?.id) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await r.json();
  const shopDomain = String(body.shopDomain || "").trim();
  const shopifyOn = Boolean(body.shopifyOn);
  const metaOn = Boolean(body.metaOn);
  const googleOn = Boolean(body.googleOn);

  await prisma.integrationSetting.upsert({
    where: { userId: s.user.id },
    create: { userId: s.user.id, shopDomain: shopDomain || null, shopifyOn, metaOn, googleOn },
    update: { shopDomain: shopDomain || null, shopifyOn, metaOn, googleOn },
  });

  return NextResponse.json({ ok: true });
}

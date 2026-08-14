import { PrismaClient, Plan } from "@prisma/client";

const prisma = new PrismaClient();

const SAMPLE_TRENDS = [
  { keyword: "silent quit", score: 92.4, volume: 48000, momentum: 34.2, source: "google" },
  { keyword: "retro kitchenware", score: 88.1, volume: 22500, momentum: 28.7, source: "tiktok" },
  { keyword: "ashwagandha gummies", score: 85.9, volume: 61000, momentum: 22.1, source: "amazon" },
  { keyword: "corecore", score: 81.3, volume: 18700, momentum: 41.5, source: "tiktok" },
  { keyword: "linen sets men", score: 79.7, volume: 34000, momentum: 18.3, source: "google" },
  { keyword: "underwater drone", score: 76.2, volume: 14200, momentum: 15.9, source: "amazon" },
  { keyword: "puzzle lamp", score: 72.8, volume: 9800, momentum: 12.4, source: "etsy" },
  { keyword: "mushroom decor", score: 69.5, volume: 44500, momentum: 9.8, source: "google" },
];

async function main() {
  console.log("Seeding database...");

  // Create demo user with credentials
  const bcrypt = await import("bcryptjs");
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@trendlynexushq.com" },
    update: {},
    create: {
      email: "demo@trendlynexushq.com",
      name: "Demo User",
      passwordHash: await bcrypt.hash("demo123456", 12),
      plan: Plan.FREE,
      integrationSettings: { create: {} },
    },
  });

  // Seed sample trend metrics for demo user
  for (const t of SAMPLE_TRENDS) {
    await prisma.trendMetric.create({
      data: { ...t, userId: demoUser.id },
    });
  }

  console.log(`Seeded ${SAMPLE_TRENDS.length} trend metrics for demo user`);
  console.log("Demo credentials: demo@trendlynexushq.com / demo123456");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

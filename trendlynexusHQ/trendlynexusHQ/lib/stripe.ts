import Stripe from "stripe";

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }

  return new Stripe(key, {
    apiVersion: "2025-08-27.basil",
  });
}

export const PLANS = {
  CREATOR: {
    amount: 2900,
    name: "Creator",
  },
  PRO: {
    amount: 7900,
    name: "Pro",
  },
} as const;

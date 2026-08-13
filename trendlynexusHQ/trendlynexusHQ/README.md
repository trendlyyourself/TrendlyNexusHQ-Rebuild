# trendlynexusHQ

Next.js App Router micro-SaaS foundation with PostgreSQL/Prisma, NextAuth credentials + magic-link authentication, Stripe Checkout, Customer Portal, and required subscription webhooks.

## Run

1. Install Node.js 20+ and PostgreSQL.
2. Copy `.env.example` to `.env` and set the values to your real PostgreSQL, SMTP, Stripe, and application settings. Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`.
3. Run `npm install`.
4. Run `npx prisma generate`.
5. Run `npx prisma migrate dev --name init`.
6. Run `npm run dev`.

## Stripe

Enable Billing Customer Portal. This implementation creates recurring prices dynamically, so no Stripe price IDs are required. Configure a webhook at `/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Use the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.

For local testing, install the Stripe CLI, run `stripe login`, then `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Vercel

`npm i -g vercel && vercel login && vercel && vercel --prod`

Set all environment variables in the Vercel project. After the production database is configured, run `npx prisma migrate deploy`. Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the deployed HTTPS origin.

## Revenue target

$8,000 MRR requires 276 Creator customers or 102 Pro customers. A mixed plan base can reach the target with fewer than 250 accounts when Pro adoption is strong. A strict $2,000/week run rate is about $8,667/month on a 52-week annualized basis.

## Important launch note

The billing/auth/data foundation is deployable. Trend ingestion, AI generation, and actual Shopify/Meta/Google OAuth data connectors are deliberately separate product modules; the schema is ready for them, but they cannot be truthfully described as live integrations until their provider credentials and OAuth applications are configured.

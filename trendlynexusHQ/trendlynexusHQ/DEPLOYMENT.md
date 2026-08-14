# trendlynexusHQ Deployment Guide

This guide covers everything needed to deploy trendlynexusHQ to production.

## Prerequisites

You need accounts (all have free tiers) for:
- **Vercel** — hosting the Next.js app
- **Neon** — PostgreSQL database (free 500MB)
- **Stripe** — payments/billing
- **Resend** (or any SMTP provider) — magic-link emails

## Step 1: Create a Neon Database

1. Go to https://neon.tech and sign up (free, no credit card)
2. Create a new project — name it `trendlynexushq`
3. Copy both connection strings:
   - **Pooled connection** → `DATABASE_URL` (has `-pooler` in the hostname)
   - **Direct connection** → `DIRECT_URL` (no `-pooler`)
4. Format: `postgres://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true`

## Step 2: Get a Vercel Token

1. Go to https://vercel.com and sign up (sign in with GitHub)
2. Go to Settings → Access Tokens → Create Token
3. Copy the token — you'll need it for deployment

## Step 3: Get Stripe Keys

1. Go to https://dashboard.stripe.com (use test mode for now)
2. Copy your **Secret API key** (`sk_test_...`)
3. After deployment, create a webhook endpoint pointing to `https://your-app.vercel.app/api/stripe/webhook`
4. Select events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
5. Copy the **webhook signing secret** (`whsec_...`)
6. Enable the Customer Portal in Stripe Settings → Billing → Customer Portal

## Step 4: Get SMTP Credentials (Resend)

1. Go to https://resend.com and sign up (free 3,000 emails/month)
2. Add and verify your domain (or use the default `onboarding@resend.dev` for testing)
3. Get your SMTP credentials:
   - Host: `smtp.resend.com`
   - Port: `465` (or `587`)
   - User: `resend`
   - Password: your Resend API key (`re_...`)
   - From: `noreply@yourdomain.com`

## Step 5: Deploy

### Option A: Using the deployment script

```bash
cd trendlynexusHQ/trendlynexusHQ

# Set all credentials
export VERCEL_TOKEN="your_vercel_token"
export DATABASE_URL="postgres://..."     # Neon pooled
export DIRECT_URL="postgres://..."        # Neon direct
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."
export SMTP_HOST="smtp.resend.com"
export SMTP_PORT="465"
export SMTP_USER="resend"
export SMTP_PASSWORD="re_..."
export EMAIL_FROM="noreply@yourdomain.com"
export NEXTAUTH_URL="https://trendlynexushq.vercel.app"
export NEXT_PUBLIC_APP_URL="https://trendlynexushq.vercel.app"

# Run the script
./DEPLOY.sh
```

### Option B: Using GitHub Actions (automatic deploy on push)

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add these repository secrets:
   - `VERCEL_TOKEN` — your Vercel API token
   - `VERCEL_ORG_ID` — your Vercel org/team ID (find in Vercel project settings)
   - `VERCEL_PROJECT_ID` — your Vercel project ID (find in Vercel project settings)
   - `DATABASE_URL` — Neon pooled connection string
   - `DIRECT_URL` — Neon direct connection string

3. Set the remaining env vars in the Vercel dashboard:
   Go to your Vercel project → Settings → Environment Variables and add:
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` — your production URL
   - `NEXT_PUBLIC_APP_URL` — your production URL
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`

4. Push to `master` — the GitHub Action deploys automatically

### Option C: Manual Vercel CLI

```bash
cd trendlynexusHQ/trendlynexusHQ
npm install
npx vercel login
npx vercel --prod
# Set env vars in Vercel dashboard
npx prisma migrate deploy
npx prisma db seed
```

## Step 6: Post-Deployment

1. Update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` in Vercel to match your actual deployment URL
2. Set up the Stripe webhook endpoint in the Stripe dashboard
3. Add the webhook signing secret as `STRIPE_WEBHOOK_SECRET` in Vercel
4. Run `npx prisma db seed` to populate sample trend data
5. Test the app:
   - Visit the homepage
   - Create an account at `/login`
   - Check the dashboard at `/dashboard`
   - Configure integrations at `/settings`

## Demo Account

After seeding, you can log in with:
- Email: `demo@trendlynexushq.com`
- Password: `demo123456`

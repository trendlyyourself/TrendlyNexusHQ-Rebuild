# trendlynexusHQ — Complete Deployment Guide

This guide covers everything from zero to production: account setup, environment configuration, database initialization, Stripe billing integration, and three deployment methods.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Step 1 — Create a Neon PostgreSQL Database](#step-1--create-a-neon-postgresql-database)
5. [Step 2 — Set Up Vercel](#step-2--set-up-vercel)
6. [Step 3 — Configure Stripe](#step-3--configure-stripe)
7. [Step 4 — Configure SMTP (Resend)](#step-4--configure-smtp-resend)
8. [Step 5 — Deploy](#step-5--deploy)
   - [Option A: One-Command Script (`DEPLOY.sh`)](#option-a-one-command-script-deploysh)
   - [Option B: GitHub Actions (Auto-Deploy on Push)](#option-b-github-actions-auto-deploy-on-push)
   - [Option C: Manual Vercel CLI](#option-c-manual-vercel-cli)
9. [Step 6 — Initialize the Database](#step-6--initialize-the-database)
10. [Step 7 — Post-Deployment Checklist](#step-7--post-deployment-checklist)
11. [Local Development](#local-development)
12. [Troubleshooting](#troubleshooting)
13. [Demo Account](#demo-account)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Vercel (Hosting)                    │
│                                                       │
│  Next.js 16 App (Turbopack)                           │
│  ├── / (Landing page)                                 │
│  ├── /login (Magic-link auth)                         │
│  ├── /dashboard (Protected — trend metrics)           │
│  ├── /settings (Protected — integrations)             │
│  └── /api/                                            │
│      ├── auth/[...nextauth] (NextAuth.js)             │
│      └── stripe/webhook (Stripe billing webhooks)     │
│                                                       │
├─────────────┬───────────────┬─────────────────────────┤
│             │               │                         │
▼             ▼               ▼                         ▼
Neon PG     Stripe API     Resend SMTP              (future)
(Database)  (Billing)      (Email)                  Integrations
```

**Tech Stack:**
- **Framework:** Next.js 16.2.11 (App Router, Turbopack)
- **Database:** Neon Serverless PostgreSQL (500MB free tier)
- **ORM:** Prisma 6.x (with pooled + direct connection strings)
- **Auth:** NextAuth.js 4.x (magic-link via SMTP)
- **Billing:** Stripe (subscriptions + customer portal)
- **Email:** Resend SMTP (3,000 emails/month free)
- **Hosting:** Vercel (serverless, auto-scale)
- **Styling:** Tailwind CSS 4.x

---

## 2. Prerequisites

All services have free tiers — no credit card required to start.

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **Neon** | PostgreSQL database | 500MB storage, 100 compute-hours/mo | https://neon.tech |
| **Vercel** | App hosting | Unlimited deployments, 100GB bandwidth | https://vercel.com |
| **Stripe** | Payment processing | Pay-per-transaction (no monthly fee) | https://stripe.com |
| **Resend** | Transactional email | 3,000 emails/month | https://resend.com |

**Local requirements:**
- Node.js ≥ 20.19.0
- npm (comes with Node)
- Git

---

## 3. Environment Variables Reference

All environment variables are defined in `.env.example`. Copy it to `.env` for local development, or set them in Vercel for production.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | ✅ | Neon **pooled** connection string (with `pgbouncer=true`). Used by the app at runtime. | `postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | ✅ | Neon **direct** connection string (no pooler). Used by `prisma migrate`. | `postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require` |
| `NEXTAUTH_SECRET` | ✅ | Secret for JWT signing. Generate with `openssl rand -base64 32`. | `UTl0HhxlBOYOkaA58bVy6vUN9EYTUkaSOXCBMk7ieXQ=` |
| `NEXTAUTH_URL` | ✅ | Canonical production URL. Set after first deploy. | `https://trendlynexushq.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public app URL (exposed to client). Same as `NEXTAUTH_URL`. | `https://trendlynexushq.vercel.app` |
| `STRIPE_SECRET_KEY` | ⚠️ | Stripe API secret key. Required for billing. | `sk_test_51Nx...` |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ | Stripe webhook signing secret. Set after creating webhook endpoint. | `whsec_...` |
| `STRIPE_CURRENCY` | Optional | Billing currency. Defaults to `usd`. | `usd` |
| `SMTP_HOST` | ⚠️ | SMTP server hostname. Required for magic-link emails. | `smtp.resend.com` |
| `SMTP_PORT` | ⚠️ | SMTP server port. | `465` |
| `SMTP_USER` | ⚠️ | SMTP username. | `resend` |
| `SMTP_PASSWORD` | ⚠️ | SMTP password (Resend API key). | `re_...` |
| `EMAIL_FROM` | ⚠️ | Sender email address. | `noreply@yourdomain.com` |

**Legend:** ✅ = required for app to start · ⚠️ = required for full functionality (app runs without it, but that feature won't work) · Optional = nice-to-have

---

## Step 1 — Create a Neon PostgreSQL Database

Neon provides serverless PostgreSQL with built-in connection pooling — essential for serverless deployments on Vercel.

1. **Sign up:** Go to https://console.neon.tech/signup — sign in with GitHub, Google, or email
2. **Create a project:**
   - Click **New Project**
   - Name: `trendlynexushq`
   - Region: `AWS US East (N. Virginia)` — closest to Vercel's default region
   - PostgreSQL version: `16` (or latest available)
   - Click **Create Project**
3. **Copy the connection strings:**
   - On the project dashboard, you'll see the **Connection Details** panel
   - **Pooled connection** (labeled "Pooled connection" or has `-pooler` in hostname):
     ```
     postgres://user:password@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true
     ```
     → This is your `DATABASE_URL`
   - **Direct connection** (labeled "Direct connection" or no `-pooler`):
     ```
     postgres://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
     ```
     → This is your `DIRECT_URL`

> **Why two URLs?** Neon's pooled connection uses PgBouncer to manage connection pooling — essential for serverless functions that create many short-lived connections. However, PgBouncer doesn't support Prisma's migration commands, which need a direct connection. The `DIRECT_URL` bypasses the pooler for migrations only.

> **Optional: Get a Neon API key** for CLI access: Go to https://console.neon.tech/app/settings/api-keys → Create new key. This enables Neon CLI usage for database management.

---

## Step 2 — Set Up Vercel

1. **Sign up:** Go to https://vercel.com/signup — sign in with GitHub (recommended)
2. **Create a Vercel API token:**
   - Go to https://vercel.com/account/settings/tokens (or Settings → Access Tokens)
   - Click **Create Token**
   - Name: `trendlynexushq-deploy`
   - Scope: Full Account (or specific team)
   - Copy the token immediately — it won't be shown again
3. **Find your Org ID and Team ID:**
   - Go to https://vercel.com/dashboard → Settings → General
   - Copy the **Vercel ID** (this is your `VERCEL_ORG_ID`)

> **Don't create a project manually.** The deployment script or GitHub Action will create the Vercel project automatically on first deploy.

---

## Step 3 — Configure Stripe

### 3a. Get your API keys

1. Go to https://dashboard.stripe.com
2. Ensure you're in **Test mode** (toggle in top right)
3. Copy your **Secret API key** (`sk_test_...`) from Developers → API Keys

### 3b. Create products and prices

Create three subscription tiers in the Stripe dashboard (Products → Add Product):

| Product Name | Billing | Price ID | Description |
|-------------|---------|----------|-------------|
| Free | N/A | — | Free tier, no Stripe product needed |
| Creator | $19/month recurring | Save the `price_...` ID | Trend tracking + 3 integrations |
| Pro | $49/month recurring | Save the `price_...` ID | Everything + unlimited integrations |

To create:
1. Go to https://dashboard.stripe.com/products
2. Click **Add Product**
3. Name it (e.g., "Creator Plan")
4. Set pricing: **Recurring → Monthly → $19.00**
5. Click **Save Product**
6. Copy the **Price ID** (`price_...`) from the product detail page
7. Repeat for the Pro plan

### 3c. Enable the Customer Portal

1. Go to https://dashboard.stripe.com/settings/billing/portal
2. Toggle **Enable Customer Portal**
3. Configure allowed features:
   - ✅ Customers can cancel subscriptions
   - ✅ Customers can update payment methods
   - ✅ Customers can switch plans
4. Click **Save**

### 3d. Create the webhook endpoint

> **Do this AFTER your first deployment** — you need the production URL.

1. Go to https://dashboard.stripe.com/webhooks
2. Click **Add endpoint**
3. URL: `https://your-app.vercel.app/api/stripe/webhook`
4. Select events to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add Endpoint**
6. Click **Signing secret** → Copy the `whsec_...` value
7. This is your `STRIPE_WEBHOOK_SECRET`

> **For local testing:** Use the Stripe CLI to forward webhooks to localhost:
> ```bash
> stripe listen --forward-to localhost:3000/api/stripe/webhook
> ```
> It prints a temporary `whsec_...` secret for local use.

---

## Step 4 — Configure SMTP (Resend)

Resend provides a modern SMTP relay with a generous free tier.

1. **Sign up:** Go to https://resend.com — sign in with GitHub or email
2. **Get your API key:**
   - Go to https://resend.com/api-keys
   - Click **Create API Key**
   - Name: `trendlynexushq`
   - Copy the key (`re_...`)
3. **Configure SMTP settings:**
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (STARTTLS)
   - Username: `resend`
   - Password: your Resend API key (`re_...`)
4. **Sender domain (optional for testing):**
   - For production: Go to https://resend.com/domains → Add your domain → Add the DNS records → Verify
   - For testing: Use Resend's default `onboarding@resend.dev` as the from address
5. **Set `EMAIL_FROM`:**
   - Production: `noreply@yourdomain.com`
   - Testing: `onboarding@resend.dev`

> **Alternative SMTP providers:** Any SMTP service works — Gmail (App Passwords), Amazon SES, Postmark, SendGrid. Just set the corresponding `SMTP_*` variables.

---

## Step 5 — Deploy

Choose one of three deployment methods. All three achieve the same result — pick based on your workflow.

### Option A: One-Command Script (`DEPLOY.sh`)

Best for: **First-time deployment** or manual control.

```bash
cd trendlynexusHQ/trendlynexusHQ

# 1. Set all credentials as environment variables
export VERCEL_TOKEN="your_vercel_api_token"
export DATABASE_URL="postgres://...pooler...neon.tech/neondb?sslmode=require&pgbouncer=true"
export DIRECT_URL="postgres://...neon.tech/neondb?sslmode=require"
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"
export NEXTAUTH_URL="https://trendlynexushq.vercel.app"
export NEXT_PUBLIC_APP_URL="https://trendlynexushq.vercel.app"
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."
export STRIPE_CURRENCY="usd"
export SMTP_HOST="smtp.resend.com"
export SMTP_PORT="465"
export SMTP_USER="resend"
export SMTP_PASSWORD="re_..."
export EMAIL_FROM="noreply@yourdomain.com"

# 2. Run the deployment script
./DEPLOY.sh
```

**What the script does:**
1. Links the project to Vercel (creates it if it doesn't exist)
2. Sets all environment variables on Vercel (encrypted)
3. Pulls Vercel config and builds the project
4. Deploys to production
5. Runs Prisma migrations against the database
6. Seeds the database with sample data

**To run migrations and seed separately:**
```bash
export DATABASE_URL="postgres://...pooler..."
export DIRECT_URL="postgres://..."
npx prisma migrate deploy
npx prisma db seed
```

---

### Option B: GitHub Actions (Auto-Deploy on Push)

Best for: **Continuous deployment** — every push to `master` deploys automatically.

#### 1. Add GitHub repository secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Value |
|-------------|-------|
| `VERCEL_TOKEN` | Your Vercel API token |
| `VERCEL_ORG_ID` | Your Vercel Org/Team ID |
| `VERCEL_PROJECT_ID` | Leave empty on first run — the Action creates the project. Then find the Project ID in Vercel → Project Settings → General, and add it. |
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_URL` | Neon direct connection string |

#### 2. Set remaining env vars in Vercel

Go to your Vercel project → Settings → Environment Variables and add:

| Variable | Value |
|----------|-------|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` output |
| `NEXTAUTH_URL` | `https://trendlynexushq.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | `https://trendlynexushq.vercel.app` |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_CURRENCY` | `usd` |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` |
| `SMTP_PASSWORD` | `re_...` |
| `EMAIL_FROM` | `noreply@yourdomain.com` |

#### 3. Trigger a deploy

Push to `master`:
```bash
git push origin master
```

The GitHub Action (`.github/workflows/deploy.yml`) will:
1. Install dependencies
2. Pull Vercel environment
3. Build the project
4. Deploy to Vercel production
5. Run Prisma migrations

> **First run note:** The first deployment creates the Vercel project. After it completes, find the `VERCEL_PROJECT_ID` in Vercel → your project → Settings → General → Project ID. Add it as a GitHub secret for subsequent deploys.

---

### Option C: Manual Vercel CLI

Best for: **Quick interactive deployment** with browser login.

```bash
cd trendlynexusHQ/trendlynexusHQ
npm install

# Log in interactively (opens browser)
npx vercel login

# Deploy to production
npx vercel --prod

# The CLI will prompt for project settings — accept the defaults

# Set environment variables in the Vercel dashboard:
# https://vercel.com/dashboard → your project → Settings → Environment Variables

# Run database migrations
export DATABASE_URL="postgres://...pooler..."
export DIRECT_URL="postgres://..."
npx prisma migrate deploy
npx prisma db seed
```

---

## Step 6 — Initialize the Database

After your first deployment, initialize the database with tables and sample data.

### Run migrations

Migrations create all database tables (User, Account, Session, Subscription, TrendMetric, ApiUsageLog, IntegrationSetting, VerificationToken):

```bash
cd trendlynexusHQ/trendlynexusHQ

export DATABASE_URL="postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
export DIRECT_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Apply migrations (uses DIRECT_URL to bypass PgBouncer)
npx prisma migrate deploy

# Seed sample data (demo user + 8 trend metrics)
npx prisma db seed
```

### Verify the database

```bash
# Open Prisma Studio (database GUI) — optional
npx prisma studio
```

Or connect directly with the Neon SQL Editor at https://console.neon.tech → your project → SQL Editor.

### What the seed creates

The seed script (`prisma/seed.ts`) creates:
- **1 demo user** — email: `demo@trendlynexushq.com`, password: `demo123456`
- **8 sample TrendMetric records** — trending keywords with scores, volume, and momentum data

---

## Step 7 — Post-Deployment Checklist

After your first successful deployment:

- [ ] **Update URLs:** Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` in Vercel to match your actual deployment URL (e.g., `https://trendlynexushq.vercel.app`)
- [ ] **Run migrations:** `npx prisma migrate deploy` (or the script did this for you)
- [ ] **Seed database:** `npx prisma db seed` (or the script did this for you)
- [ ] **Create Stripe webhook:** Add webhook endpoint in Stripe dashboard → copy `whsec_...` → set as `STRIPE_WEBHOOK_SECRET` in Vercel
- [ ] **Test webhook:** Make a test payment in Stripe and verify the webhook is received
- [ ] **Test auth:** Visit `/login` → enter email → check for magic-link email → click link → verify redirect to dashboard
- [ ] **Test dashboard:** Visit `/dashboard` → verify trend metrics load from the database
- [ ] **Test settings:** Visit `/settings` → verify integration toggles work
- [ ] **Test billing:** Visit `/settings` → click "Upgrade" → complete Stripe checkout → verify subscription status updates
- [ ] **Verify environment:** No errors in Vercel deployment logs

---

## Local Development

### Prerequisites

- Node.js ≥ 20.19.0
- A Neon database (or local PostgreSQL)

### Setup

```bash
cd trendlynexusHQ/trendlynexusHQ

# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Fill in your credentials
# At minimum you need DATABASE_URL and DIRECT_URL for the database to work
# NEXTAUTH_SECRET is required for auth
# SMTP_* enables magic-link emails
# STRIPE_* enables billing

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed the database
npx prisma db seed

# Start the dev server
npm run dev
```

Visit http://localhost:3000

### Useful commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Start production server (after build) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create and apply a new migration |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Seed sample data |
| `npm run db:studio` | Open Prisma Studio (database GUI at http://localhost:5555) |

### Local Stripe webhooks

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` and set it as `STRIPE_WEBHOOK_SECRET` in your `.env`.

---

## Troubleshooting

### Build fails with "Prisma can't reach database"

**Cause:** `DATABASE_URL` not set during build, or connection string is wrong.

**Fix:** The build step runs `prisma generate` (which doesn't need a live DB connection) but `next build` may try to connect for static generation. Ensure your database is reachable and the connection string has `?sslmode=require`.

### "Environment variable not found" in Vercel

**Cause:** Env vars set in GitHub secrets but not in Vercel project settings.

**Fix:** Set all non-secret env vars (like `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`) directly in Vercel → Settings → Environment Variables. GitHub secrets are only used by the GitHub Action, not by Vercel at runtime.

### Magic-link emails not arriving

**Cause:** SMTP credentials incorrect, or sender domain not verified.

**Fix:**
1. Check `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` are set correctly
2. If using Resend, verify your domain at https://resend.com/domains
3. For testing, use `onboarding@resend.dev` as `EMAIL_FROM`
4. Check spam folder

### Stripe webhooks failing

**Cause:** Webhook endpoint URL incorrect, or signing secret mismatch.

**Fix:**
1. Ensure the webhook URL is `https://your-app.vercel.app/api/stripe/webhook` (not localhost)
2. Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret from Stripe dashboard
3. Check Vercel function logs for the `/api/stripe/webhook` route
4. Test with `stripe trigger checkout.session.completed` (via Stripe CLI)

### Prisma migration fails with "too many connections"

**Cause:** Using the pooled connection string for migrations.

**Fix:** Ensure `DIRECT_URL` is set to the **direct** (non-pooler) connection string. Prisma uses `directUrl` for `migrate` commands. Verify your `schema.prisma` has:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### "NEXTAUTH_URL" mismatch error

**Cause:** `NEXTAUTH_URL` doesn't match the actual deployment URL.

**Fix:** Update `NEXTAUTH_URL` in Vercel environment variables to match your exact Vercel URL (e.g., `https://trendlynexushq.vercel.app`). Redeploy after changing.

### Vercel project not found (GitHub Actions)

**Cause:** `VERCEL_PROJECT_ID` not set or incorrect.

**Fix:** On the first deploy, the GitHub Action creates the project automatically. After the first run, go to Vercel → your project → Settings → General → copy the **Project ID**. Add it as a GitHub secret `VERCEL_PROJECT_ID`. Also add `VERCEL_ORG_ID` from the same settings page.

### Prisma client not generated

**Cause:** Build command doesn't include `prisma generate`.

**Fix:** The `vercel.json` build command is set to `prisma generate && next build`. If you changed it, ensure `prisma generate` runs before `next build`.

---

## Demo Account

After seeding the database, you can log in with:

| Field | Value |
|-------|-------|
| Email | `demo@trendlynexushq.com` |
| Password | `demo123456` |

The demo account has:
- **Plan:** FREE
- **8 sample trend metrics** with scores, volume, and momentum data
- **No active subscriptions** (upgrade via Stripe to test billing)

---

## Project Structure

```
trendlynexusHQ/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions auto-deploy
├── .env.example                # Environment variable template
├── .nvmrc                      # Node version (20)
├── DEPLOY.sh                   # One-command deployment script
├── DEPLOYMENT.md               # This file
├── package.json                # Dependencies and scripts
├── vercel.json                 # Vercel build configuration
├── prisma/
│   ├── schema.prisma           # Database schema (7 models)
│   ├── seed.ts                 # Sample data seeder
│   └── migrations/
│       └── 0001_init/
│           └── migration.sql   # Initial migration (all tables)
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing page
│   ├── globals.css             # Tailwind CSS
│   ├── login/
│   │   └── page.tsx            # Magic-link login
│   ├── dashboard/
│   │   └── page.tsx            # Protected dashboard (trend metrics)
│   ├── settings/
│   │   └── page.tsx            # Protected settings (integrations + billing)
│   └── api/
│       ├── auth/
│       │   └── [...nextauth]/
│       │       └── route.ts    # NextAuth.js handler
│       └── stripe/
│           └── webhook/
│               └── route.ts    # Stripe webhook handler
├── components/
│   ├── nav.tsx                  # Dashboard navigation
│   └── ...                     # UI components
└── lib/
    ├── auth.ts                  # NextAuth configuration
    ├── prisma.ts                # Prisma client singleton
    └── stripe.ts                # Stripe client
```

---

## Security Notes

- **Never commit `.env` to git.** The `.gitignore` file excludes it.
- **Never commit credentials to the repository.** Use Vercel environment variables or GitHub secrets.
- **Rotate the `NEXTAUTH_SECRET`** if it's ever exposed.
- **Use Stripe test keys** (`sk_test_...`) until you're ready to accept real payments.
- **Verify your Resend domain** before sending production emails.

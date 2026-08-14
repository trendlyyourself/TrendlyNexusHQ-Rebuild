#!/bin/bash
# trendlynexusHQ deployment script
# Run from the trendlynexusHQ/trendlynexusHQ directory
# Prerequisites: Vercel CLI installed, VERCEL_TOKEN exported

set -e

echo "🚀 Deploying trendlynexusHQ to Vercel"

# 1. Link project to Vercel (creates project if it doesn't exist)
echo "→ Linking Vercel project..."
vercel link --yes --project trendlynexushq --token=$VERCEL_TOKEN

# 2. Set environment variables
echo "→ Setting environment variables..."

set_env() {
  local key=$1
  local value=$2
  local target=$3
  echo "  - $key ($target)"
  echo "$value" | vercel env add $key $target --token=$VERCEL_TOKEN 2>/dev/null || true
}

# Generate NEXTAUTH_SECRET if not provided
NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-$(openssl rand -base64 32)}

set_env "DATABASE_URL" "$DATABASE_URL" "production"
set_env "DIRECT_URL" "$DIRECT_URL" "production"
set_env "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET" "production"
set_env "NEXTAUTH_URL" "$NEXTAUTH_URL" "production"
set_env "NEXT_PUBLIC_APP_URL" "$NEXT_PUBLIC_APP_URL" "production"
set_env "SMTP_HOST" "$SMTP_HOST" "production"
set_env "SMTP_PORT" "$SMTP_PORT" "production"
set_env "SMTP_USER" "$SMTP_USER" "production"
set_env "SMTP_PASSWORD" "$SMTP_PASSWORD" "production"
set_env "EMAIL_FROM" "$EMAIL_FROM" "production"
set_env "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY" "production"
set_env "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET" "production"
set_env "STRIPE_CURRENCY" "${STRIPE_CURRENCY:-usd}" "production"

# 3. Pull, build, deploy
echo "→ Building and deploying..."
vercel pull --yes --environment=production --token=$VERCEL_TOKEN
vercel build --prod --token=$VERCEL_TOKEN
DEPLOY_URL=$(vercel deploy --prebuilt --prod --yes --token=$VERCEL_TOKEN)

echo ""
echo "✅ Deployed to: $DEPLOY_URL"
echo ""

# 4. Run Prisma migrations
if [ -n "$DATABASE_URL" ]; then
  echo "→ Running Prisma migrations..."
  npx prisma migrate deploy
  echo "→ Seeding database..."
  npx prisma db seed
fi

echo ""
echo "🎉 trendlynexusHQ is live at: $DEPLOY_URL"
echo ""
echo "Next steps:"
echo "  1. Update NEXTAUTH_URL and NEXT_PUBLIC_APP_URL in Vercel to match the deployment URL"
echo "  2. Configure Stripe webhook at: $DEPLOY_URL/api/stripe/webhook"
echo "  3. Add the webhook signing secret as STRIPE_WEBHOOK_SECRET in Vercel"

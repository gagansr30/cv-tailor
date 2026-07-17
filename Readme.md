# CV Tailor

An AI-powered CV tailoring web app. Paste your CV and a job description, and it rewrites your CV to better match the role — reordering and rephrasing your real experience to align with the job's language. No invented skills, no fabricated numbers, no exaggerated experience.

It also shows its work rather than acting as a black box:
- **What Changed & Why** — a plain-English breakdown of the specific edits made and the reasoning behind each one
- **Skills Missing From Your CV** — an honest gap analysis against the job description

## Features

- AI-powered CV tailoring via the Anthropic Claude API, under a strict no-fabrication system prompt
- Change transparency: shows exactly what was edited and why
- Skills gap analysis against the job description
- Download tailored CV as Word (.docx) or PDF
- User accounts (email/password) via Supabase Auth
- Tiered access: 3 free tailored CVs (lifetime), then a paid subscription for up to 100/month
- Stripe-powered subscription billing with webhook-driven status sync
- Deployed as a static frontend + serverless backend on Vercel

## Tech Stack

- **Frontend:** Plain HTML/CSS/JavaScript (no framework)
- **Backend:** Node.js serverless functions (Vercel `/api`)
- **AI:** Anthropic Claude API
- **Auth & Database:** Supabase (Postgres + Auth, Row Level Security)
- **Payments:** Stripe (Checkout + Webhooks)
- **Document generation:** `docx` (Word) and `pdf-lib` (PDF)
- **Hosting:** Vercel

## Project Structure

```
cv-tailor/
├── index.html                     # Main page (auth UI + tailoring UI)
├── script.js                      # Frontend logic (auth, tailoring, downloads, paywall)
├── style.css                      # Styling
├── package.json
├── vercel.json                    # Vercel function config
├── supabase-setup.sql             # Run once in Supabase to create the profiles table
├── SUBSCRIPTION_SETUP.md          # Full setup guide for auth + billing
├── .env.local                     # Local environment variables (never committed)
└── api/
    ├── config.js                  # Exposes public keys to the frontend
    ├── tailor-cv.js               # Calls Claude, enforces usage limits
    ├── generate-docx.js           # Renders tailored CV as a Word document
    ├── generate-pdf.js            # Renders tailored CV as a PDF
    ├── user-status.js             # Returns usage/subscription status
    ├── create-checkout-session.js # Starts a Stripe Checkout session
    ├── stripe-webhook.js          # Handles Stripe events, updates subscription status
    └── _lib/
        ├── auth.js                # Verifies Supabase session, loads/creates profile
        ├── supabaseAdmin.js       # Server-side Supabase client (service_role key)
        ├── rawBody.js             # Raw body reader for Stripe signature verification
        └── constants.js           # Usage limit constants
```

## Local Development

**Prerequisites:** Node.js 18+, the Vercel CLI (`npm install -g vercel`)

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Copy `.env.local` and fill in real values (see **Environment Variables** below)
3. Run the SQL in `supabase-setup.sql` inside your Supabase project (SQL Editor)
4. Start the dev server:
   ```
   vercel dev
   ```
5. Open the local URL it prints (usually `http://localhost:3000`)

For the full walkthrough of setting up Supabase and Stripe from scratch, see **`SUBSCRIPTION_SETUP.md`**.

## Environment Variables

| Variable | Description |
|---|---|
| `CLAUDE_API_KEY` | Anthropic API key ([console.anthropic.com](https://console.anthropic.com)) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key (safe for frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role/secret key (server-only, never expose) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-only) |
| `STRIPE_PRICE_ID` | Stripe Price ID for the subscription product |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (created after first deploy — see `SUBSCRIPTION_SETUP.md`) |

Set these in `.env.local` for local development, and in Vercel → Settings → Environment Variables for production. Restart `vercel dev` after any change — env vars are only read at process startup.

## Deployment

1. Push to GitHub and import the repo in Vercel (or run `vercel --prod` directly)
2. Add all environment variables above in Vercel's dashboard
3. Create the Stripe webhook pointing at `https://your-domain/api/stripe-webhook` (needs a live URL first — see `SUBSCRIPTION_SETUP.md` step 4)
4. Redeploy once the webhook secret is added

## Usage Limits

- **Free tier:** 3 tailored CVs, lifetime, per account
- **Subscribers:** up to 100 tailored CVs per calendar month, resetting on the 1st
- A basic in-memory IP rate limiter also applies to `/api/tailor-cv` (5 requests/minute) as a speed bump against abuse — not a substitute for the above limits, and resets on server cold start

## Known Limitations

- The IP-based rate limiter is in-memory only and resets on cold start — not a robust production rate limiter
- Quality of the "Skills Missing" and "What Changed" analysis depends on how clearly the pasted CV is structured
- `vercel dev` on some setups doesn't reliably auto-load `.env.local`; a manual fallback loader is included in `api/tailor-cv.js` as a workaround

## License / Ownership

Personal project, built solo by Gagan S R.
# CV Tailor

An AI-powered CV tailoring web app. Upload or paste your CV and a job description, and it rewrites your CV to better match the role — reordering and rephrasing your real experience to align with the job's language. No invented skills, no fabricated numbers, no exaggerated experience.

It also shows its work rather than acting as a black box:
- **What Changed & Why** — a plain-English breakdown of the specific edits made and the reasoning behind each one
- **Skills Missing From Your CV** — an honest gap analysis against the job description, with an explicit confirmation step before adding anything (never adds a skill without you confirming genuine experience with it)
- **Skills relevance review** — actively flags skills that don't connect to *this specific* job, pre-selected for optional removal, so each tailored version stays focused

## Features

- AI-powered CV tailoring via the Anthropic Claude API, under a strict no-fabrication system prompt
- **Upload a CV file** (PDF or Word) or paste text directly
- Fixed, professional CV template: centered name/contact, clean section headings, consistent across the preview and both downloads
- **Inline keyword highlighting** — job-relevant terms are bolded so a recruiter scanning quickly sees what matches, rendered consistently in the browser preview, DOCX, and PDF
- Change transparency: shows exactly what was edited and why
- Skills gap analysis with an honesty-confirmation step before adding anything
- Skills relevance review: AI flags skills not clearly relevant to the specific job, user approves removal
- Download tailored CV as Word (.docx) or PDF — both use real extractable text, standard section headings, no tables/images, and continuous (ATS-friendly) text runs even with inline bold styling
- Clickable links in the PDF (LinkedIn, GitHub, project demos) via real PDF link annotations
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
- **Document generation:** `docx` (Word) and `pdf-lib` (PDF, with manual link annotations and native PDF word-spacing for justified text)
- **File upload parsing:** `mammoth` (DOCX → text), `pdf-parse` (PDF → text)
- **Hosting:** Vercel

## Project Structure

```
cv-tailor/
├── index.html                     # Main page (auth UI + tailoring UI)
├── script.js                      # Frontend logic (auth, tailoring, downloads, paywall, skills review)
├── style.css                      # Styling
├── package.json
├── vercel.json                    # Vercel function config
├── supabase-setup.sql             # Run once in Supabase to create the profiles table
├── SUBSCRIPTION_SETUP.md          # Full setup guide for auth + billing
├── .env.local                     # Local environment variables (never committed)
└── api/
    ├── config.js                  # Exposes public keys to the frontend
    ├── tailor-cv.js                # Calls Claude, enforces usage limits, sanitizes/dedupes output
    ├── extract-cv-text.js         # Extracts text from an uploaded PDF or DOCX CV
    ├── generate-docx.js           # Renders tailored CV as a Word document
    ├── generate-pdf.js            # Renders tailored CV as a PDF (with clickable links)
    ├── user-status.js             # Returns usage/subscription status
    ├── create-checkout-session.js # Starts a Stripe Checkout session
    ├── stripe-webhook.js          # Handles Stripe events, updates subscription status
    └── _lib/
        ├── auth.js                # Verifies Supabase session, loads/creates profile, resets monthly usage
        ├── supabaseAdmin.js       # Server-side Supabase client (service_role key)
        ├── rawBody.js             # Raw body reader for Stripe signature verification
        ├── boldSegments.js        # Parses **bold** markers for DOCX/PDF/preview rendering
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

> **Note (Windows):** `vercel dev` may print noisy but harmless output on Windows — `Warning: TT:` font-parsing warnings from PDF text extraction, `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` from the Vercel CLI's process handling, and a `taskkill ... not found` error when stopping the server with Ctrl+C. None of these affect the app; they're cosmetic CLI/OS-level noise.

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

**Important:** in Supabase → Authentication → URL Configuration, set the **Site URL** to your live production domain once deployed (it defaults to `http://localhost:3000`, which breaks confirmation/reset email links for real users). Add both your local and production URLs to the Redirect URLs allow-list.

## Deployment

1. Push to GitHub and import the repo in Vercel (or run `vercel --prod` directly)
2. Add all environment variables above in Vercel's dashboard
3. Create the Stripe webhook pointing at `https://your-domain/api/stripe-webhook` (needs a live URL first — see `SUBSCRIPTION_SETUP.md` step 4)
4. Redeploy once the webhook secret is added
5. Update Supabase's Site URL to your production domain (see note above)

## Usage Limits

- **Free tier:** 3 tailored CVs, lifetime, per account
- **Subscribers:** up to 100 tailored CVs per calendar month, resetting on the 1st
- A basic in-memory IP rate limiter also applies to `/api/tailor-cv` (5 requests/minute) as a speed bump against abuse — not a substitute for the above limits, and resets on server cold start

## ATS Compliance Notes

Both the DOCX and PDF outputs use single-column layouts, standard fonts, real extractable text (not images), and standard section headings — all verified to avoid common ATS parsing failures. The PDF specifically:
- Merges same-styled text into continuous runs (rather than drawing word-by-word) so bold keyword highlighting doesn't fragment extracted text into single words
- Uses PDF's native word-spacing operator for justified paragraphs, so text stays continuous *and* evenly spaced
- Uses real PDF link annotations (not just styled text) for LinkedIn/GitHub/project links, with automatic `https://` scheme normalization so bare-domain links (e.g. `linkedin.com/in/x`) don't get misinterpreted as local file paths by PDF viewers

Format compliance doesn't guarantee passing a specific ATS screen — that still depends on whether the candidate's actual skills match the job's actual requirements. The app is intentionally designed to surface genuine gaps (via Skills Missing / Skills Relevance) rather than mask them.

## Known Limitations

- The IP-based rate limiter is in-memory only and resets on cold start — not a robust production rate limiter
- Quality of the "Skills Missing," "Skills Relevance," and "What Changed" analysis depends on how clearly the pasted/uploaded CV is structured, and on the underlying model's judgment (prompt-tunable, not deterministic)
- PDF file uploads that are scanned images (no embedded text layer) won't extract any text — the user is prompted to paste the CV text directly instead

## License / Ownership

Personal project, built solo by Gagan S R.
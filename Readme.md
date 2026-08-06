# CV Tailor

A full-stack SaaS app that rewrites your CV to match a specific job description, using the Anthropic Claude API under a strict no-fabrication system prompt. Set up your profile once, then generate a tailored, ATS-checked version of your CV for any job in under 20 seconds.

**Live demo:** _add your Vercel URL here after deploying_
**Repo:** https://github.com/gagansr30/cv-tailor

Built solo, end to end: auth, billing, AI integration, and document generation (real DOCX and PDF output, not just styled HTML).

## Why it's different from a generic "AI resume builder"

Most CV tools either invent achievements to sound impressive or produce a document that looks fine on screen and falls apart the moment an ATS parses it. This one does neither:

- **Nothing is invented.** The system prompt is explicit: reorder, rephrase, and re-emphasize real experience, never add a skill, metric, or achievement that isn't already in the candidate's CV. If the job wants something the candidate genuinely doesn't have, the app says so instead of papering over it.
- **It shows its work.** A "What Changed and Why" panel explains every edit, a "Skills Missing" panel flags honest gaps with a confirmation step before adding anything, and a "Skills Relevance" review flags skills that don't fit *this* job so the candidate can trim a focused, targeted CV rather than a kitchen-sink one.
- **The ATS score is computed, not guessed.** The model extracts the job description's actual screening keywords once; the match score is then calculated deterministically from real keyword coverage in the generated document, the same way applicant tracking systems actually work. A separate ATS Compatibility Check builds the real downloadable file, runs it through the same text-extraction path a parser would use, and shows exactly what survives.
- **The output documents are real, parseable files.** Single column, standard fonts, no tables or images, continuous text runs even with inline bold keyword highlighting, and real clickable link annotations in the PDF, not just styled text.

## Features

- AI-powered CV tailoring against any pasted job description
- Upload a CV as PDF or Word, or paste text directly, with hyperlinks preserved from the original file
- One-time profile setup: the AI reads your CV into an editable structured profile that becomes the base for every future tailoring pass, so you never re-paste your CV
- 10 CV templates (Classic, Modern, Elegant, Compact, Finance/Academic, Scholar, Executive, Cardinal, One-Page Tech, Timeline), all single-column and ATS-safe, only typography and layout accents differ
- Editable section order: apply the AI's recommended order or rearrange sections and entries yourself before downloading
- ATS Match Score, computed from real keyword coverage before and after tailoring
- ATS Compatibility Check: builds your actual document, extracts its text the way a parser would, and checks contact field recognition, section headings, date parsing, and keyword coverage
- Download as Word (.docx) or PDF, both with real selectable text and working hyperlinks
- Email/password accounts via Supabase Auth
- Free tier plus a paid monthly subscription via Stripe Checkout, with webhook-driven status sync

## Tech stack

- **Frontend:** Plain HTML, CSS, and JavaScript. No framework, no build step.
- **Backend:** Node.js serverless functions on Vercel
- **AI:** Anthropic Claude API, called server-side only
- **Auth and database:** Supabase (Postgres, Auth, Row Level Security)
- **Payments:** Stripe Checkout and webhooks
- **Document generation:** `docx` for Word output, `pdf-lib` for PDF output with hand-built link annotations and native PDF word-spacing for justified text
- **File parsing:** `mammoth` for DOCX to text and hyperlink extraction, `pdf-parse` and `pdf-lib` for PDF text and link-annotation extraction
- **Hosting:** Vercel

## Project structure

```
cv-tailor/
├── index.html                     # Main page: auth UI + the tailoring app
├── script.js                      # Frontend logic: auth, profile editor, tailoring, downloads, paywall
├── style.css                      # Styling
├── package.json
├── vercel.json                    # Per-function timeout config
└── api/
    ├── config.js                  # Exposes public keys (Supabase URL/anon key, Stripe publishable key) to the frontend
    ├── tailor-cv.js                # Calls Claude, enforces usage limits, computes the ATS score
    ├── parse-cv.js                 # Reads a raw CV into the structured profile schema, no rewriting, no credit cost
    ├── base-cv.js                  # Get/save/clear the user's saved base CV profile
    ├── extract-cv-text.js         # Extracts text (and hyperlinks) from an uploaded PDF or DOCX
    ├── generate-docx.js           # Renders a tailored CV as a Word document
    ├── generate-pdf.js            # Renders a tailored CV as a PDF, with clickable links
    ├── ats-check.js                # Builds the real output document and reports what an ATS parser would see
    ├── user-status.js             # Returns usage and subscription status
    ├── create-checkout-session.js # Starts a Stripe Checkout session
    ├── stripe-webhook.js          # Handles Stripe events, syncs subscription status
    └── _lib/
        ├── auth.js                # Verifies the Supabase session, loads/creates the profile row, resets monthly usage
        ├── supabaseAdmin.js       # Server-side Supabase client (service_role key, never exposed to the frontend)
        ├── cvShape.js              # Shared CV shape normalization and text serialization
        ├── atsScore.js             # Deterministic keyword-coverage scoring
        ├── boldSegments.js        # Parses **bold** and [label](url) markers for DOCX/PDF/preview rendering
        ├── templates.js            # The 10 CV template definitions shared by the DOCX and PDF generators
        ├── rawBody.js              # Raw body reader, needed for Stripe signature verification
        └── constants.js            # Usage limit constants
```

## Local development

**Prerequisites:** Node.js 18+, the Vercel CLI (`npm install -g vercel`)

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Create `.env.local` in the project root with the variables listed below.
3. Run the SQL in **Database setup** (next section) inside your Supabase project's SQL editor.
4. Start the dev server:
   ```
   vercel dev
   ```
5. Open the local URL it prints (usually `http://localhost:3000`).

> **Note (Windows):** `vercel dev` can print noisy but harmless output on Windows: `Warning: TT:` font-parsing warnings during PDF text extraction, an `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` line from the Vercel CLI's process handling, and a `taskkill ... not found` message when stopping the server with Ctrl+C. None of these affect the app.

## Environment variables

| Variable | Description |
|---|---|
| `CLAUDE_API_KEY` | Anthropic API key ([console.anthropic.com](https://console.anthropic.com)) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key (safe for the frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role/secret key (server-only, never expose) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-only) |
| `STRIPE_PRICE_ID` | Stripe Price ID for the subscription product |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (created after your first deploy, once you register the webhook) |

Set these in `.env.local` for local development and in Vercel under Settings → Environment Variables for production. Restart `vercel dev` after any change; env vars are only read at process startup.

## Database setup

Run this once in your Supabase project's SQL editor. It creates the `profiles` table the app reads and writes, with Row Level Security enabled so a user can only ever read their own row (the app's server-side code uses the service_role key and bypasses RLS by design, but RLS still protects the table if the anon key were ever used directly).

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  usage_count integer not null default 0,
  monthly_usage_count integer not null default 0,
  usage_period_start date,
  subscription_status text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  base_cv jsonb,
  base_cv_updated_at timestamptz
);

alter table profiles enable row level security;

create policy "Users can read their own profile"
  on profiles for select
  using (auth.uid() = id);
```

The app's backend always uses the Supabase service_role key, which bypasses these policies, so the API endpoints work regardless. The policy above only matters if you ever query `profiles` directly from the frontend with the anon key.

**Important:** in Supabase under Authentication → URL Configuration, set the Site URL to your live production domain once deployed. It defaults to `http://localhost:3000`, which breaks confirmation and password-reset email links for real users. Add both your local and production URLs to the Redirect URLs allow-list.

## Deployment

1. Push to GitHub and import the repo in Vercel, or run `vercel --prod` directly.
2. Add every environment variable above in the Vercel dashboard.
3. Create a Stripe webhook pointing at `https://your-domain/api/stripe-webhook`, listening for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. This needs a live URL, so do it after your first deploy.
4. Add the resulting webhook signing secret as `STRIPE_WEBHOOK_SECRET` and redeploy.
5. Update Supabase's Site URL to your production domain (see note above).

## Usage limits

- **Free tier:** 2 tailored CVs, lifetime, per account
- **Subscribers:** up to 100 tailored CVs per calendar month, resetting on the 1st
- A basic in-memory IP rate limiter also applies to the AI-calling endpoints (5-8 requests per minute) as a speed bump against abuse. It resets on every serverless cold start, so it is not a substitute for the limits above, just an extra layer.

## ATS compliance notes

Both the DOCX and PDF outputs use single-column layouts, standard fonts, real extractable text (never images), and standard section headings, all chosen to avoid the parsing failures that trip up most CV formats. The PDF generator specifically:

- Merges same-styled text into continuous runs instead of drawing word by word, so bold keyword highlighting doesn't fragment extracted text into single words
- Uses PDF's native word-spacing operator for justified paragraphs, so text stays continuous and evenly spaced at the same time
- Uses real PDF link annotations, not just styled text, for LinkedIn/GitHub/project links, with automatic `https://` scheme normalization so a bare domain like `linkedin.com/in/x` doesn't get misread as a local file path by PDF viewers

Format compliance doesn't guarantee passing any specific ATS screen; that still depends on whether the candidate's actual skills match the job's actual requirements. The app is built to surface genuine gaps through the Skills Missing and Skills Relevance panels rather than mask them.

## Known limitations

- The IP-based rate limiter is in-memory only and resets on cold start, so it's a speed bump rather than a robust production rate limiter
- The quality of the "Skills Missing," "Skills Relevance," and "What Changed" analysis depends on how clearly the source CV is structured and on the underlying model's judgment; it is prompt-tuned, not deterministic
- Scanned-image PDFs with no embedded text layer won't extract any text; the app prompts the user to paste the CV text directly instead

## License

Personal project, built solo by Gagan S R. [LinkedIn](https://www.linkedin.com/in/gagansr/)

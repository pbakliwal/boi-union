# Deploying with Render + Supabase (free tier)

The simplest deploy for this app: **Render** runs the single Node process
(API + built React frontend — same as running it locally, no code split
needed), **Supabase** is just the Postgres database. No Vercel, no CORS, no
cross-origin cookies to worry about.

**Cost note:** both have genuinely durable free tiers for an app this size.
Render's free web service **spins down after ~15 minutes of inactivity** and
takes ~30-60s to wake up on the next request — fine for an internal union app
that isn't checked constantly, worth knowing so it doesn't look "broken" on
first load after a quiet period.

## 1. Push this repo to GitHub

Render deploys by connecting to a GitHub (or GitLab) repo.

```bash
cd /Users/pbakliwal/Preetish/Personal/boi_union
git init
git add .
git commit -m "Initial commit"
```
Then create an empty repo on GitHub (github.com/new — do **not** initialize it
with a README) and push:
```bash
git remote add origin https://github.com/<you>/boi-union.git
git branch -M main
git push -u origin main
```

## 2. Create the Supabase project (the database)

1. [supabase.com](https://supabase.com) → New project. Pick a strong database
   password (you'll paste it into a connection string next — save it somewhere).
2. Once it's provisioned: **Project Settings → Database → Connection string**.
   Copy the **URI** under "Direct connection" (not the pooler/transaction one —
   Render runs one persistent process here, so it doesn't need PgBouncer).
3. It looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`
   Replace `[YOUR-PASSWORD]` with the real password. This full string is your
   `DATABASE_URL`.

## 3. Deploy to Render

1. [render.com](https://render.com) → New → **Blueprint** → connect the GitHub
   repo you just pushed. Render will read `render.yaml` from the repo root and
   pre-fill the service (Node, free plan, build/start commands already set).
2. When prompted for the env vars marked "generate/enter a value" in the
   blueprint, fill in:
   - `DATABASE_URL` — the Supabase connection string from step 2
   - `SESSION_SECRET` — run `openssl rand -hex 32` locally and paste the output
   - `ADMIN_USER` — e.g. `admin`
   - `ADMIN_PASSWORD` — a real password (min 8 chars)
3. Click **Apply**. Render will `npm install`, build the client, run
   migrations, create the admin user, then start the app. Watch the deploy
   log — first deploy takes a few minutes.
4. Once live, Render gives you a URL like `https://boi-union.onrender.com`.
   Open it and log in with the `ADMIN_USER`/`ADMIN_PASSWORD` you set.

(If you'd rather not use the Blueprint: New → Web Service → connect the repo →
set Build Command `npm install --include=dev && npm run build && npm run migrate && npm run setup`
(the `--include=dev` is required — `NODE_ENV=production` makes plain `npm install` skip
devDependencies, which breaks the client build since `vite` is one),
Start Command `npm start`, plan Free, then add the same env vars by hand plus
`NODE_ENV=production` and `DATABASE_SSL=true`.)

## 4. Load real data

Log in as admin → **Import Salary Register** → upload your CSV/Excel file.

## 5. Custom domain (optional)

Render's free plan supports custom domains: service → Settings → Custom
Domains → add your domain → point a `CNAME` at the hostname Render gives you.

## 6. Redeploying updates later

Just `git push` to the connected branch — Render redeploys automatically,
re-running the same build command (migrate/setup are safe to re-run; they
skip work that's already done).

## Troubleshooting

- **Deploy log** (Render dashboard → your service → Logs) — shows build output
  and runtime errors (e.g. a bad `DATABASE_URL` shows up here as a connection
  failure).
- **"self-signed certificate" / SSL errors connecting to Supabase** — confirm
  `DATABASE_SSL=true` is set (the blueprint sets this already).
- **Cold start feels slow** — expected on the free plan after ~15 min idle;
  not an error.

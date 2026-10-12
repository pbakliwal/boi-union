# Bank of India Employees' Union — MP

Membership and monthly-contribution management for the union's Madhya Pradesh
zones. Replaces the legacy DOS/FoxPro system with a small, self-hostable web app.

- **Server:** Node.js (Express) + PostgreSQL
- **Client:** React + Vite (plain CSS)
- **Layout:** npm workspaces — `server/` and `client/`

## What it does

- **Master data:** Zones → Districts → Branches, Members (including an optional
  mobile number), Categories (roles), and effective-dated contribution **Rates**.
- **Monthly flow:** generate a **draft** for every active member at their current
  rate → **audit** (edit amounts, mark not-received, add remarks) → **finalize**
  (locks the month). Members who transferred keep the branch they were in when the
  month was generated, because each entry snapshots branch + category + amount.
- **Out-of-state members:** flagged on the member record and highlighted (⚑) in the
  audit grid so the auditor can adjust their amount on the draft — there is no stored
  per-member override; the standard category rate is applied at generation.
- **Reports:** Monthly Summary (Zone→District), District Detail, One-Third
  (quarterly), and Yearly Members list. All exportable to CSV. The two full-year
  reports — Yearly Members and One-Third — can be viewed on either **calendar year**
  (Jan–Dec) or **Indian financial year** (Apr–Mar) basis; a toggle switches between
  them and the "year" field's meaning updates accordingly (for FY, it's the year the
  financial year *starts* — e.g. entering 2026 shows FY 2026-27, April 2026 through
  March 2027).

## Roles

- **admin** — full access to everything.
- **viewer** — read-only; can view masters and reports but not edit.

Admins manage accounts from the admin-only **Users** screen: create admin/viewer
users, change roles, and reset passwords. Safeguards prevent deleting your own
account or removing/demoting the last remaining admin.

## Prerequisites

- Node.js 18+
- PostgreSQL 13+ (a database you can connect to)

## Setup

```bash
# 1. Install all workspace dependencies (server + client)
npm install

# 2. Configure environment
cp .env.example .env
#    then edit .env — set DATABASE_URL, a strong SESSION_SECRET,
#    and the initial ADMIN_USER / ADMIN_PASSWORD

# 3. Create the schema
npm run migrate

# 4. Create the admin account + seed placeholder categories
npm run setup
```

## Development

Run the API and the Vite dev server in two terminals:

```bash
npm run dev:api   # Express on http://localhost:3000
npm run dev:web   # Vite on   http://localhost:5173  (proxies /api → 3000)
```

Open http://localhost:5173 and sign in with the admin credentials from `.env`.

## Production — free-tier hosting (Render + Supabase)

The lowest-effort option: **Render** runs the app as-is (one Node process,
same as local dev), **Supabase** is the Postgres database. No code split, no
CORS. See **[deploy/RENDER_SUPABASE.md](deploy/RENDER_SUPABASE.md)** for the
full walkthrough — a `render.yaml` blueprint at the repo root lets Render
auto-configure the service once you connect the GitHub repo.

## Production (single VPS)

```bash
npm run build              # builds client → client/dist
NODE_ENV=production npm start   # Express serves the API AND client/dist on PORT
```

Put it behind nginx with HTTPS (Secure cookies require it in production). Point a
process manager (systemd / pm2) at `npm start` in the repo root.

**Full step-by-step VPS walkthrough (firewall, systemd unit, nginx + certbot,
backups, redeploying updates): see [deploy/SETUP.md](deploy/SETUP.md).** Ready-made
config templates live in [deploy/](deploy/) — `boi-union.service` and `nginx.conf`.

## First-run checklist in the app

1. **Categories** — rename the two seeded categories and note their meaning.
2. **Rates** — add a rate per category with an `effective_from` date.
3. **Zones → Districts → Branches** — build the geography.
4. **Members** — add members (unique **Employee ID**, branch, category; flag
   out-of-state members).
5. **Monthly** — generate the current month, audit it, then finalize.
6. **Reports** — view/export.

## Importing the monthly salary register

The bank's monthly "salary register deductions" CSV is the source of truth. Importing it
**auto-creates masters** (Indore zone/district, each branch, each `SCALE` as a category with
a rate — CK\*=100, SS\*=50), **upserts employees** (keyed by Employee ID), and builds that
month's **draft** contributions — flagging any amount that is **0/NIL** (`zero`) or **≠ the
expected rate** (`differs`) so it stands out in the audit grid. Each contribution **snapshots**
its own month's branch/category/amount, so per-month reports stay accurate even after a member
transfers.

### Bulk writes and safe retries

Imports use set-based PostgreSQL writes (JSON recordsets), not one SQL round-trip per
member. Roughly 500 members are imported in one transaction, with a bounded number of
queries independent of the member count. Preview executes the same bulk path but rolls
it back.

- **All or nothing:** members, masters, contributions and the import receipt commit
  together. A database error or server crash before commit leaves no partial import.
  Retry the whole file rather than resuming at a row number.
- **Lost response after commit:** retrying the same parsed file, month and options
  returns the last successful receipt (`alreadyApplied: true`), without rewriting data
  or undoing manually corrected amounts. This works across server restarts.
- **No duplicates:** Employee ID and month/member uniqueness constraints remain the
  final database safeguard. Duplicate Employee IDs inside a file are rejected with an
  actionable error instead of silently choosing a row.
- **Changed file:** a different file replaces that month's draft atomically, as before,
  including any manual corrections. A finalized month must first be reopened.
- **Concurrent imports:** a transaction-scoped advisory lock serializes imports across
  months to keep the latest roster consistent. A period row lock protects against
  finalization during import. Locks release automatically on transaction completion.
- **Receipt lifetime:** only the latest successful file receipt for each period is
  retained. Deleting the month or regenerating its draft clears it. Re-uploading an
  earlier, different file after a replacement is a new replacement, not a retry.

Run `npm run migrate` before starting the updated server (including on Supabase/Render).
No system can guarantee that a database or network never fails; this design guarantees
atomic data changes and safe same-file retries rather than partial progress.

**Master data vs. the report.** Importing a changed file for a month only rewrites *that month's contributions*
(the report) — it never wipes master data. The member roster (branch/category/active-or-left)
is synced **only when importing the latest month**; importing an **older** month is a back-fill
that records just its contributions and leaves the current master untouched. The export layout
varies month to month (column order/names, `UNION CODE-` prefixes, `TOTAL` vs trailing `NIL`,
quoted commas) — the parser handles all of these.

**Deleting a month.** On the Monthly page (or the audit header) an admin can **Delete** a
month — this removes only that month's contributions and the period row; members, branches and
categories it created are kept. A finalized month must be **reopened** before it can be deleted.

⚠️ The **"Generate"** button (Monthly page) fills a month at *standard* rates and will overwrite
a file-imported draft. For file-driven months, use **Import**, not Generate.

**Either CSV or the original Excel workbook (.xlsx/.xls) works directly** — no need to
"Save As CSV" first. Excel parsing (via a patched build of SheetJS — see note below) reads
the actual numeric cell values, so numbers Excel would otherwise mangle into scientific
notation in a CSV export (e.g. a 12-digit mobile number shown as `9.18085E+11`) come through
intact.

**In the app (admin):** *Import Salary Register* → choose the CSV or Excel file, confirm
month/year, **Preview** (dry-run, nothing saved) → review the summary + flagged list → **Apply**.
After applying, edit flagged amounts directly in the import result and click **Save** on each
row. If a missing deduction has been collected, also check **Received** so it counts in
reports. Corrections are saved to the monthly draft; finalized months must be reopened before
editing. Flags and import remarks retain the original file's anomalies, and the import summary
shows the original totals before manual edits. Open the draft to edit remarks or other entries.

**From the CLI:**
```bash
# fresh bootstrap (wipes masters + contributions, then loads the file)
node server/scripts/ingest.js data/UNION_APR26.csv --month 4 --year 2026 --reset
node server/scripts/ingest.js data/UNION_APR26.xlsx --month 4 --year 2026 --reset

# subsequent months (incremental: upsert + mark-left, no wipe)
node server/scripts/ingest.js data/AUG26.xlsx         # month/year inferred from filename
node server/scripts/ingest.js data/AUG26.xlsx --dry   # parse + run, then roll back
```
Month/year are inferred from a `MONYY` token in the filename (e.g. `…APR26…` → April 2026)
when the flags are omitted. A finalized month must be reopened before it can be re-imported.
Retrying its already-successful file simply returns the receipt even if the month is finalized.

**Import regression tests:** `npm run test -w server` runs validation tests; set
`INGEST_TEST_DATABASE_URL` to a PostgreSQL connection string to additionally run the
500-member integration suite. The suite creates and removes a randomly named isolated
schema and never modifies application tables. It checks bounded query counts, retries,
rollback, duplicate rejection, concurrent imports, backfills and finalized-month behavior.

**Header detection checks the first five rows.** For both CSV and Excel, the parser selects
the first complete header containing Employee ID, Name, Location/Branch, Scale/Grade, and a
union/deduction column, using the supported column aliases. Titles and blank rows above it
are ignored, but count toward the five-row limit. Employee data is parsed from the following
row. A leading `SN` column is optional, and columns can be reordered. If no valid header is
found in those five rows, the import reports the existing header or missing-column error.

⚠️ **Security note:** the npm-published `xlsx` package has known unpatched vulnerabilities
(prototype pollution, ReDoS — no fix on the npm registry). This project instead installs the
patched build directly from SheetJS's own CDN (see `server/package.json`'s `xlsx` dependency,
a CDN tarball URL rather than a version range). Run `npm audit` after any `npm install` involving
this package to confirm it stays clean.

## Project layout

```
server/
  index.js            Express app + middleware + static (prod)
  config.js           env loading
  db.js               pg pool + helpers
  migrate.js          forward-only SQL migration runner
  auth.js             session auth middleware
  scripts/setup.js    initial admin + seed
  migrations/         *.sql
  routes/             auth, users, categories, zones, districts, branches,
                      rates, members, periods, contributions, reports
client/
  src/
    api.js, auth.jsx, hooks.js, App.jsx
    components/        Layout, Modal, CrudPage
    pages/            Login, Monthly, Audit, Import, Users, masters.jsx
  ingestCore.js       CSV parse + master/employee sync + draft build (shared)
  scripts/ingest.js   CLI importer (--reset / --dry)
    pages/reports/    Summary, DistrictDetail, OneThird, Yearly
```

## Security notes

- Passwords hashed with bcrypt; sessions stored in PostgreSQL, `httpOnly` cookies.
- All SQL uses parameterized queries.
- Secrets live only in `.env` (never commit it).
- CSP is disabled by default for the bundled build — tighten in `server/index.js`
  if you serve from an untrusted network.

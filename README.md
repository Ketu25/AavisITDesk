# Aavis IT Desk

Internal IT ticketing for Aavis Pharma. ~100 staff across QA, QC, Finance,
Manufacturing, Warehouse, IT, Front Desk, HR, CEO, President and Maintenance.

Self-contained auth (no AD/SSO), admin-provisioned accounts only, one shared
service-desk queue, SLA tracking, and a one-way Microsoft Teams notification on
every new ticket.

- **Frontend** — Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Motion
- **Backend** — Supabase: Postgres, Auth, Row Level Security, Edge Functions
- **Project** — `alslqimadvhrriwdkgrm` (`https://alslqimadvhrriwdkgrm.supabase.co`)

---

## Getting it running

```bash
npm install
npm run dev
```

### 1. Environment

`.env.local` is already populated except for one value you must supply
yourself:

```
SUPABASE_SERVICE_ROLE_KEY=
```

Get it from **Supabase dashboard → Project Settings → API keys → `service_role`**.

Without it the app runs and everything else works, but user provisioning is
disabled — inviting, CSV import, enable/disable and auto-assign all need it.
The People page shows a banner while it is missing. It is server-only and must
never be exposed to the browser or committed.

### 2. Supabase Auth configuration (one-time, in the dashboard)

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | `http://localhost:3000` (your real host in production) |
| Redirect URLs | `http://localhost:3000/**` (add the production host too) |

Invite and password-reset links will not work until these are set.

**Authentication → Emails → SMTP Settings** — Supabase's built-in mailer is
rate limited to a handful of messages per hour and is meant for testing.
Configure your own SMTP provider before bulk-importing ~100 people, or the
import will stop partway with a rate-limit error (it tells you when it does).

### 2b. Email templates — stop link scanners burning invites (important)

Supabase's default invite email uses `{{ .ConfirmationURL }}`, which is a
single-use link that is spent by whoever fetches it first. Corporate mail
security — Microsoft 365 Safe Links, most gateways — fetches every URL in an
incoming message to scan it. The scanner spends the token, the address gets
confirmed with no human involved, and the real recipient clicks a dead link.

This app defends against that: `/invite` and `/reset-password` never spend a
token on page load, only when someone presses the button. To use that
defence, point the templates at those pages.

**Authentication → Emails → Templates → Invite user**, change the link to:

```html
<a href="{{ .SiteURL }}/invite?token_hash={{ .TokenHash }}&type=invite">
  Set up your account
</a>
```

**Authentication → Emails → Templates → Reset password**:

```html
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">
  Choose a new password
</a>
```

Both pages also still accept the default `ConfirmationURL` style, so nothing
breaks if you leave the templates alone — you just keep the scanner exposure.

### 2c. Raise the auth email rate limit

**This is separate from SMTP and catches almost everyone.** Supabase caps auth
emails per hour *regardless of which provider sends them* — a new project
allows only a couple. Once you exceed it, invites and resets return
`429 email rate limit exceeded` and no email is sent at all.

Raise it under **Authentication → Rate Limits → "Rate limit for sending
emails"**. Note the built-in mailer is capped low no matter what you set there;
a custom SMTP provider is what actually lets you raise it meaningfully.

### 3. First sign-in

A bootstrap administrator already exists: **`aavisitdesk@gmail.com`**.

It was created without a usable password on purpose — nothing was ever
transmitted in plaintext. To get in:

1. Open `/login` and click **Forgot your password?**
2. Enter `aavisitdesk@gmail.com`
3. Follow the emailed link and choose your own password

That address is on the allow-list as an explicit exception; everyone else must
be at `aavispharma.com` (editable under **Settings → Who can be given an
account**).

To create a different first admin instead:

```bash
npm run bootstrap:admin -- someone@aavispharma.com "Their Name"
```

---

## Deploying to Cloudflare Workers

The app runs on Cloudflare via [OpenNext](https://opennext.js.org/cloudflare).
`wrangler.jsonc` and `open-next.config.ts` are committed, so the build does not
have to guess anything.

```bash
npm run preview   # build and run the Worker locally
npm run deploy    # build and deploy
```

Wrangler needs **Node 22+** locally. Cloudflare's build image already uses 24.

### Cloudflare Workers Builds settings

In the dashboard, under **your Worker → Settings → Build**:

| Branch | Build command | Deploy command |
|---|---|---|
| Production | `npm run build` | `npx wrangler deploy` |
| Non-production | `npm run build` | `npx wrangler versions upload` |

**`npm run build` is the OpenNext build, not `next build`.** That is deliberate.
Cloudflare defaults the build command to `npm run build` and there are *two*
build configurations — production and non-production — so the previous layout,
where the real build lived under a separate `build:cf`, broke every time one of
them was left at the default. Three builds failed that way before the scripts
were changed to make the default correct. Plain `next build` is still available
as `build:next` for a fast compile-and-typecheck loop.

The deploy step needs the OpenNext bundle in `.open-next/` — the entry point at
`.open-next/worker.js` (what `wrangler.jsonc` sets as `main`) and the compiled
config at `.open-next/.build/open-next.config.mjs`. `next build` produces only
`.next/`, so if the build command is ever pointed back at plain Next, the build
*succeeds* and the deploy fails afterwards — with `wrangler versions upload`:

```
✘ [ERROR] The entry-point file at ".open-next/worker.js" was not found.
```

or, with `wrangler deploy`:

```
ERROR Could not find compiled Open Next config, did you run the build command?
```

To tell which build actually ran, read the line after `Executing user build
command` in the log. The correct one starts `rm -rf .next .open-next && …
opennextjs-cloudflare build`; a bare `next build` is the broken case.

`opennextjs-cloudflare build` runs `next build` itself, so Next is only built
once. (Setting the deploy command to `npm run deploy` also works, but then Next
is built twice per deploy for no benefit.)

> **Node 22+ is required locally.** The build fails on older runtimes with
> `SyntaxError: Invalid regular expression flags` from the ESM loader, which
> names no file and does not look like a version problem. Cloudflare's build
> image already uses Node 24.

### Worker name

`wrangler.jsonc` sets `name` **and** the `WORKER_SELF_REFERENCE` service
binding to the same value. They must match — a self-reference binding pointing
at a name that is not the Worker's own fails the deploy with:

```
Service binding 'WORKER_SELF_REFERENCE' references Worker '...' which was not
found. [code: 10143]
```

If you rename the Worker in the Cloudflare dashboard, change **both** values here.

### Public configuration lives in `.env.production`

`NEXT_PUBLIC_*` values are **inlined into the bundle by `next build`**, so they
have to exist when the build runs. A Cloudflare Worker *runtime* variable is
applied far too late and is simply ignored — and because the proxy builds a
Supabase client on every request, a missing value takes down every route,
including `/login`, as an unexplained 500.

They are therefore committed in `.env.production` rather than left to dashboard
settings. All three are public by design: the URL and publishable key ship in
the browser bundle of every Supabase app, and Row Level Security is the actual
security boundary.

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.production` (committed) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.production` (committed) |
| `NEXT_PUBLIC_SITE_URL` | `.env.production` (committed) |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker **secret** — never committed |

Real environment variables still take precedence over the file, so a dashboard
build variable can override any of it. The same three are also declared under
`vars` in `wrangler.jsonc` so a deploy stops silently deleting whatever was set
in the dashboard.

If one is ever missing, the proxy now returns a **503 naming the variable**
instead of a blank 500, so the failure is diagnosable from the response body.

### Runtime secret

`SUPABASE_SERVICE_ROLE_KEY` is only read server-side, so it belongs on the
Worker rather than the build:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Without it the app still runs, but user provisioning is disabled and the People
page says so.

### Four things to change once the domain is live

1. **Supabase → Authentication → URL Configuration** — set Site URL to the
   production host and add `https://<host>/**` to Redirect URLs, or password
   reset and invite links will bounce.
2. **Admin → Settings → Application base URL** — this is what Teams
   notifications deep-link to. It still points at `http://localhost:3000`.
3. **`NEXT_PUBLIC_SITE_URL`** above — the `redirectTo` on emailed invite and
   password-reset links is built from it, so it must exactly match an entry in
   Supabase's Redirect URLs. The `/activate` link shown in the credentials
   panel does *not* use it: that is derived from the admin's own browser
   origin, so it is always correct without configuration.
4. **QR labels** — every code is printed with `NEXT_PUBLIC_SITE_URL` as it was
   at the time. Print labels after the move, or keep the old host answering:
   a label already stuck on a printer cannot be updated.

### Known caveat

The proxy (`src/proxy.ts`) uses `@supabase/ssr` for session refresh, which needs
the Node.js runtime. OpenNext reports *"Node.js middleware support is
experimental in cloudflare"* during the build. It works, but it is the part of
this deployment most likely to break on an adapter upgrade — worth checking
first if sessions start behaving oddly after one.

---

## Roles

Roles are additive and stored as one field on the user record.

| Role | Can do |
|---|---|
| `user` | Submit tickets (including quick tickets), track and comment on their own, confirm or reopen a resolution |
| `agent` | Everything a user can, plus work the shared queue: assign, re-prioritise, change status, leave internal notes, see reports, print QR labels for quick-ticket groups |
| `admin` | Everything an agent can, plus invite/deprovision people, manage departments, SLA rules, routing rules, quick tickets and settings |

Agents and admins raise their own tickets exactly like anyone else.

**Enforcement lives in the database, not the UI.** Every table has Row Level
Security; role checks run inside Postgres policies and trigger functions, so a
hand-crafted API call from a `user` account is rejected the same way a hidden
button would be. The API routes re-check as a second layer.

---

## User lifecycle

```
invited ──► pending ──► active ──► disabled ──► active (re-enable)
```

- **No public sign-up.** Only admins create accounts.
- **Invites** use Supabase Auth's invite email: a time-limited, single-use link.
  The recipient sets their own password. No temporary password is ever sent.
- **Resend** re-sends the invite for a pending account without deleting or
  recreating it, so the account keeps its id and history. For an account that is
  already active, the same button sends a password-reset link instead.
- **Disabling** blocks sign-in and kills live sessions immediately. It never
  deletes anything: tickets and comments stay attributed to that person. There
  is no delete path for accounts anywhere in the app or the RLS policies.
- **Activation means a password was set, not an email confirmed.** A link
  scanner can confirm an address; only a person can choose a password. An
  account stays `pending` until `profiles.password_set_at` is filled, so a
  scanned invite never looks accepted. **Resend invite** keys off the same
  field, and clears a scanner-confirmed state so a fresh invite can be issued
  (it refuses outright if a password already exists, so it cannot hijack a live
  account).
- **Email allow-list** — a domain list plus individual address exceptions,
  enforced server-side by `public.is_email_allowed()`, which is called both by
  the API and by a trigger on `profiles`. An address that fails it cannot be
  inserted even with a direct database call.

### How accounts are created

Supabase's built-in mailer allows only a couple of auth emails an hour, which
makes email-delivered invites unusable for onboarding a company. The default
path therefore sends no email at all:

1. **People → Add user.** Enter work email, full name, department and role.
   Leave the password blank to generate a strong one, or type your own.
2. The account is created immediately and the temporary password is shown
   **once**, with copy and CSV download. It is never stored in readable form —
   a lost one is reissued, not recovered.
3. Send the person that password and the link to **`/activate`** however you
   like — chat, in person, a phone call.
4. They enter their email, the temporary password, and a password of their own.
   From that moment the temporary one is dead.

Until they do step 4, the account is `pending`: it can authenticate, and that
is all. `is_active_user()` is false, so every RLS policy fails closed; every
page redirects to `/activate`; every API route returns 403. Verified by
signing in with a temporary password and confirming zero tickets, zero
departments and only the account's own profile row are reachable.

**Activation cannot be faked.** The database records a fingerprint of the
password hash when the temporary password is issued, and grants activation only
when the current hash differs. A session that calls the activation endpoint
without actually changing its password is refused.

Temporary passwords expire after the window in **Settings → Invite link
validity** (48 hours by default). After that an admin issues a new one with
**New password** on the People row, which also signs out any live session for
that account.

Email invites are still available — tick *"Email them an invite link instead"* —
and *Forgot your password?* still works on the login page. Both remain subject
to the mail rate limit, so they are a fallback rather than the default.

### Bulk import

**People → Import CSV**. Header row required (no password column — one is
generated per person):

```csv
email,name,department,role
priya.sharma@aavispharma.com,Priya Sharma,QA,user
sam.oduya@aavispharma.com,Sam Oduya,IT,agent
```

`role` defaults to `user`. `department` must match an existing department name
(case-insensitive). Rows are validated in the browser first and shown with
per-row problems; only valid rows are submitted, and each row is created
independently so one bad address never aborts the batch. Limit 500 rows.

Every generated password is shown once after the import, with **Copy all** and
**Download CSV** so you can distribute them. Nothing is emailed, so a full
company import runs in one pass with no rate limit.

---

## SLA

`sla_rules` is a table, not application logic. Each priority has a target
duration and an at-risk percentage:

| Priority | Target | Flags at risk |
|---|---|---|
| Urgent | 2 h | 60% |
| High | 8 h | 70% |
| Normal | 24 h | 75% |
| Low | 72 h | 80% |

- `sla_due_at` is set on insert from the ticket's priority, so an **unassigned**
  ticket still burns its clock — that is what makes the queue's default
  "needs attention" sort meaningful.
- Changing priority re-targets the deadline from the original creation time.
- Moving a ticket to **Waiting** pauses the clock; leaving that status pushes
  the deadline forward by exactly the time spent waiting.
- **Reopening** starts a fresh clock.
- A resolved or closed ticket is judged once, against when it was actually
  resolved, and then reads *Met* or *Breached* permanently.

### Closed is terminal

A `closed` ticket accepts no further comments — from the requester *or* an
agent. That is enforced by RLS, re-checked in the API route, and reflected in
the UI, so a direct PostgREST call is refused the same way the hidden reply box
is. It keeps the timeline honest: a reply can never appear after the closing
event.

`resolved` is deliberately still open to replies — that is the window in which
the requester says "actually, this isn't fixed". An agent who needs to add
something to a closed ticket moves it back to **In progress** first, which is
recorded in `ticket_events`.

---

## Assignment

On insert, in order:

1. The matching **routing rule** — if it names a default owner who is still an
   active agent, the ticket goes to them.
2. Otherwise the queue-wide **strategy** from Settings:
   - `least_busy` — fewest open tickets (default)
   - `round_robin` — whoever waited longest for a ticket
   - `off` — stays unassigned until an agent picks it up

Agents can always override manually, or hit **Auto-assign** on a ticket.

---

## Quick tickets

Common problems written up once by an admin — *Printer → Paper jam*,
*Shared drive → Drive not showing* — that anyone can report from **Quick
tickets** in the sidebar, or by typing in ⌘K.

- **Groups first.** The page shows each group as a card of the same size,
  however many quick tickets it holds. Opening one grows the card into a
  pop-up over the page listing them as tiles (a bottom sheet on a phone);
  closing shrinks it back into the card. The open group is kept in the address
  (`/quick-tickets?group=<id>`), so a refresh or Back reopens it and IT can
  link straight to one. Arrow keys move between cards and between tiles. Past
  eight quick tickets a filter box appears; typing in it skips the cards and
  lists the matching quick tickets directly.
- **Your open reports first.** Above the cards, the requester's unfinished
  tickets raised from quick tickets, each with how far along it is and whose
  move it is, updating live — so the jam reported this morning is seen before
  it is reported again.
- **Nothing is sent on one tap.** Picking one moves the pop-up on to a short
  confirmation, with a way back to the list (from ⌘K or the filter it opens as
  a dialog of its own). It shows the title IT will receive, its category and
  urgency, with the department and full details one press away. The requester can add a
  note, and answers the admin's question if the quick ticket has one ("Which
  printer?"); with no question, Send has focus and Enter sends. The answer is
  added to the ticket title, so five paper-jam tickets can still be told apart
  in the queue.
- **Routing is unchanged.** A quick ticket points at a routing rule by id, so
  its tickets are assigned, prioritised (a category's default still lifts
  Normal) and notified exactly like any other.
- **Duplicates are a decision.** If the requester already has an unfinished
  ticket from the same quick ticket, they are shown it and must choose to send
  another.
- **No stale sends.** If an admin edits a quick ticket while someone has it
  open, the requester is shown the new version before anything goes. Two
  admins editing at once cannot overwrite each other (`revision` check).
- **Switched off means off.** A hidden quick ticket, group or category is
  refused by the insert trigger, not just hidden in the UI.
- **History is kept.** A quick ticket that has raised tickets can be hidden but
  not deleted, and a routing rule quick tickets use cannot be deleted. Tickets
  store a copy of the text, so editing a quick ticket never rewrites one sent.

Admins manage groups and quick tickets in **Administration → Quick ticket
setup**, laid out the way requesters see them: one card per group, with
whether it is live and how often its quick tickets are used, and a card at the
end for adding a group. A card's menu moves the group earlier or later, hides
or shows it, and opens its details or deletes it. Opening a card grows it into
the same kind of pop-up requesters get, where its quick tickets are reordered,
switched live or hidden, added and edited; the editor and the group's own
details slide in inside the pop-up, and leaving either with unsaved changes
asks first.

Agents get **Service desk → Quick ticket setup** too, read-only: the groups
requesters can use, and their QR labels.

### QR labels

A sticker for a group, stuck where its problems happen — on the printer, by
the meeting-room screen. Scanning it with a phone camera opens Quick tickets
with that group already open, so a paper jam is a scan and a tap.

- **Printing.** Quick ticket setup → **QR labels** (`/admin/quick-tickets?labels`),
  or *Print QR labels…* on a group card's menu; agents and admins both can.
  Each line is a group, an optional "where it goes" ("HP LaserJet · 2nd
  floor") and how many; Enter in "where it goes" starts the next line. Sheets
  are Avery 5160 / 8160 — US Letter, 30 labels of 1″ × 2⅝″ — printed straight
  from the browser at real size. Any spots on the first sheet can be picked —
  say 1 and 7 on one that's been used before — and labels fill them top to
  bottom in the order listed; with none picked they fill from spot 1, and any
  that don't fit go on fresh sheets from the top. Label outlines plus a
  millimetre nudge (remembered per browser) are there for a test on plain
  paper. Print at 100% / "Actual size" with
  headers and footers off. Chrome, Edge, Firefox and Safari 18.2+ honour the
  page size; older Safari adds its own margins and the printer warns about it.
- **What a code holds.** `NEXT_PUBLIC_SITE_URL` + `/q/<group id>`, and
  `?at=<where it goes>` when the label says. Printing stores nothing — the
  address is everything — so a label survives a rename, and stops working when
  its group is deleted or switched off: whoever scans it is told so and shown
  every other quick ticket instead. Hidden groups can be labelled ahead of time
  (admins only), with a warning.
- **Scanning.** `/q/<group>` needs a session like everything else. The first
  scan on a phone goes through sign-in and comes back to the group, query and
  all — and through choosing a password, for someone on a temporary one. The
  label's location answers the quick ticket's question ("Which printer?"),
  which also puts it in the ticket's title, or starts the note when there is
  no question; the requester sees it and can change it.

---

## Notifications

A trigger on `tickets` insert calls the `notify-new-ticket` Edge Function via
`pg_net`, authenticated with a shared secret held in the `private` schema
(outside the exposed API). Because it is a database trigger, a ticket created
by *any* path — the app, a SQL insert, an import — still notifies.

**Deployed and wired already.** To switch it on:

1. In Teams, add an **Incoming Webhook** connector to your `#IT-Tickets`
   channel (or a Workflows *"When a Teams webhook request is received"*
   trigger). Copy the URL.
2. Paste it into **Settings → Notifications → Microsoft Teams incoming webhook
   URL**.

That is all — the function posts an Adaptive Card with the ticket number,
department, priority, description and a deep link back to the ticket.

**Email fallback** is optional and needs SMTP credentials as Edge Function
secrets (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) plus
an address in **Settings → IT distribution email**. Without them the email leg
records itself as `skipped`, never as failed.

Every attempt is written to `notification_log` with its outcome, so a silent
failure is visible in the database.

### Escalation (stubbed, ready to schedule)

`public.run_sla_escalation()` is idempotent and safe to run on a timer. It
records an `escalated` event for tickets still unassigned past the configured
threshold, an `sla_breached` event for open tickets past their deadline, and
re-pings the notification function with the matching `kind`. Nothing calls it
on a schedule yet. To wire it up:

```sql
create extension if not exists pg_cron;
select cron.schedule('sla-escalation', '*/5 * * * *', $$select public.run_sla_escalation()$$);
```

---

## Security posture

- **Every table has RLS enabled**, with no `DELETE` policy on `profiles`,
  `tickets`, `ticket_comments` or `ticket_events` — history cannot be destroyed
  through the API.
- **Guard triggers** back up the policies: a requester who calls PostgREST
  directly still cannot change a ticket's priority, category or assignee, and
  cannot change their own role, status, email or department.
- **`ticket_events` has no insert policy at all.** Every audit row is written by
  a `SECURITY DEFINER` trigger, so the trail cannot be forged from a client.
- **Trigger functions and privileged helpers have `EXECUTE` revoked** from
  `PUBLIC`, `anon` and `authenticated`, so none of them are reachable over
  `/rest/v1/rpc`.
- **The Teams webhook secret lives in a `private` schema** that PostgREST does
  not expose. It is never returned to a client — the Settings page only reports
  whether one is set, and rotation shows the new value exactly once.

Supabase's database linter reports nine remaining warnings on this project.
All are intentional: four are the role helpers (`is_admin`, `is_agent`,
`is_active_user`, `current_profile_role`) which *must* stay executable by
`authenticated` because RLS policies reference them and policy evaluation runs
as the calling role — they only reveal the caller's own role. The other four
(`report_summary`, `get_notification_endpoint`, `set_notification_endpoint`,
`rotate_notification_secret`) each re-check `is_agent()` or `is_admin()` as
their first statement.

### One thing to switch on

**Authentication → Policies → Leaked password protection.** It checks new
passwords against HaveIBeenPwned and is off by default. There is no API for it;
flip it in the dashboard. Consider raising the minimum password length there
too — the invite screen asks for 10 characters, but only the server setting
enforces it.

---

## Data model

| Table | Purpose |
|---|---|
| `departments` | Admin-managed list. Never hardcoded. |
| `profiles` | One row per auth user: role, status, department, invite/activation timestamps |
| `app_settings` | Singleton: allow-list, notification targets, assignment strategy, escalation |
| `email_allowlist` | Individual address exceptions to the domain allow-list |
| `sla_rules` | Priority → duration and at-risk threshold |
| `routing_rules` | Category → default owner / department / priority. Also the category dropdown. |
| `quick_ticket_groups` | Admin-managed groups of quick tickets (Printer, Shared drive): name, icon, order, live/hidden |
| `quick_tickets` | One common problem: routing rule, title, details, urgency, optional question, `revision` |
| `tickets` | `AAV-####` number, requester, department, category, priority, status, assignee, SLA fields, the quick ticket it came from |
| `ticket_comments` | Public replies and agent-only internal notes |
| `ticket_events` | Append-only audit trail, written by triggers only — no client insert policy exists |
| `notification_log` | Delivery outcome per channel per ticket |

Migrations are in `supabase/migrations/`, applied in filename order, and match
what is live on the project.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build — the OpenNext bundle Cloudflare deploys |
| `npm run build:next` | Plain `next build`, for a fast compile and typecheck |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run bootstrap:admin -- <email> "<Name>"` | Invite or promote an administrator |

---

## Out of scope for v1

AD/SSO, a two-way Teams bot (claim buttons that write back), SMS/phone paging,
and per-department queues — the queue is deliberately shared, with department
as a filter.

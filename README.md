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

## Roles

Roles are additive and stored as one field on the user record.

| Role | Can do |
|---|---|
| `user` | Submit tickets, track and comment on their own, confirm or reopen a resolution |
| `agent` | Everything a user can, plus work the shared queue: assign, re-prioritise, change status, leave internal notes, see reports |
| `admin` | Everything an agent can, plus invite/deprovision people, manage departments, SLA rules, routing rules and settings |

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
- **Email allow-list** — a domain list plus individual address exceptions,
  enforced server-side by `public.is_email_allowed()`, which is called both by
  the API and by a trigger on `profiles`. An address that fails it cannot be
  inserted even with a direct database call.

### Bulk import

**People → Import CSV**. Header row required:

```csv
email,name,department,role
priya.sharma@aavispharma.com,Priya Sharma,QA,user
sam.oduya@aavispharma.com,Sam Oduya,IT,agent
```

`role` defaults to `user`. `department` must match an existing department name
(case-insensitive). Rows are validated in the browser first and shown with
per-row problems; only valid rows are submitted, and each row is invited
independently so one bad address never aborts the batch. Limit 500 rows.

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
| `tickets` | `AAV-####` number, requester, department, category, priority, status, assignee, SLA fields |
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
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run bootstrap:admin -- <email> "<Name>"` | Invite or promote an administrator |

---

## Out of scope for v1

AD/SSO, a two-way Teams bot (claim buttons that write back), SMS/phone paging,
and per-department queues — the queue is deliberately shared, with department
as a filter.

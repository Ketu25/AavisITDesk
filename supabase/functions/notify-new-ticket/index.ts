// notify-new-ticket
//
// Invoked by a database trigger (pg_net) on ticket insert, and by the
// escalation sweep. One-way only: v1 never writes back from Teams.
//
// Auth: a shared secret in `x-webhook-secret`, verified against the value in
// private.notification_config. JWT verification is off because the caller is
// the database, not a signed-in user.

import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "new_ticket" | "escalation" | "sla_breach";

type Payload = {
  ticket: {
    id: string;
    ticket_number: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
    status: string;
    created_at: string;
    sla_due_at: string | null;
    department: string | null;
    requester: string | null;
    requester_email: string | null;
    assignee: string | null;
  };
  settings: {
    teams_webhook_url: string | null;
    it_distribution_email: string | null;
    notify_teams_enabled: boolean;
    notify_email_enabled: boolean;
    app_base_url: string | null;
  };
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "attention",
  high: "warning",
  normal: "accent",
  low: "good",
};

const HEADLINE: Record<Kind, string> = {
  new_ticket: "New ticket",
  escalation: "Escalation — still unassigned",
  sla_breach: "SLA breached",
};

function adaptiveCard(kind: Kind, { ticket }: Payload, link: string) {
  const facts = [
    { title: "Department", value: ticket.department ?? "—" },
    { title: "Category", value: ticket.category },
    { title: "Priority", value: ticket.priority },
    { title: "Raised by", value: ticket.requester ?? "—" },
    { title: "Assigned to", value: ticket.assignee ?? "Unassigned" },
  ];

  if (ticket.sla_due_at) {
    facts.push({ title: "SLA due", value: new Date(ticket.sla_due_at).toUTCString() });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body: [
            {
              type: "TextBlock",
              text: `${HEADLINE[kind]} · ${ticket.ticket_number}`,
              weight: "Bolder",
              size: "Medium",
              color: PRIORITY_COLOR[ticket.priority] ?? "default",
              wrap: true,
            },
            { type: "TextBlock", text: ticket.subject, wrap: true, spacing: "Small" },
            {
              type: "TextBlock",
              text: ticket.description,
              wrap: true,
              isSubtle: true,
              size: "Small",
              maxLines: 4,
            },
            { type: "FactSet", facts },
          ],
          actions: [{ type: "Action.OpenUrl", title: "Open ticket", url: link }],
        },
      },
    ],
  };
}

function emailBody(kind: Kind, { ticket }: Payload, link: string) {
  return [
    `${HEADLINE[kind]}: ${ticket.ticket_number}`,
    "",
    ticket.subject,
    "",
    `Department: ${ticket.department ?? "—"}`,
    `Category:   ${ticket.category}`,
    `Priority:   ${ticket.priority}`,
    `Raised by:  ${ticket.requester ?? "—"}${
      ticket.requester_email ? ` <${ticket.requester_email}>` : ""
    }`,
    `Assigned:   ${ticket.assignee ?? "Unassigned"}`,
    ticket.sla_due_at ? `SLA due:    ${new Date(ticket.sla_due_at).toUTCString()}` : "",
    "",
    ticket.description,
    "",
    link,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * SMTP is optional. When the vars are absent the email leg is recorded as
 * "skipped" rather than "failed" — Teams is the primary channel.
 */
async function sendEmail(to: string, subject: string, body: string) {
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  const from = Deno.env.get("SMTP_FROM") ?? user;

  if (!host || !user || !pass || !from) {
    return { status: "skipped" as const, detail: "SMTP is not configured on this function" };
  }

  const { SMTPClient } = await import("jsr:@denodrivers/smtp@0.12.0");
  const client = new SMTPClient({
    connection: {
      hostname: host,
      port: Number(Deno.env.get("SMTP_PORT") ?? 465),
      tls: (Deno.env.get("SMTP_TLS") ?? "true") !== "false",
      auth: { username: user, password: pass },
    },
  });

  try {
    await client.send({ from, to, subject, content: body });
    return { status: "sent" as const, detail: `Emailed ${to}` };
  } finally {
    await client.close().catch(() => {});
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const secret = request.headers.get("x-webhook-secret");
  const { data: valid } = await supabase.rpc("verify_notification_secret", {
    p_secret: secret,
  });

  if (!valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { ticket_id?: string; kind?: Kind };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const ticketId = body.ticket_id;
  const kind: Kind = body.kind ?? "new_ticket";

  if (!ticketId) {
    return new Response(JSON.stringify({ error: "ticket_id is required" }), { status: 400 });
  }

  const { data, error } = await supabase.rpc("notification_payload", { p_ticket_id: ticketId });

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? "Ticket not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = data as Payload;
  const base = (payload.settings.app_base_url ?? "").replace(/\/$/, "");
  const link = base ? `${base}/tickets/${payload.ticket.id}` : payload.ticket.ticket_number;

  const log = async (channel: "teams" | "email", status: string, detail: string) => {
    await supabase.from("notification_log").insert({
      ticket_id: ticketId,
      channel,
      kind,
      status,
      detail: detail.slice(0, 500),
    });
  };

  const results: Record<string, string> = {};

  // ---------------------------------------------------------------- Teams
  if (!payload.settings.notify_teams_enabled) {
    results.teams = "disabled";
    await log("teams", "skipped", "Teams notifications are switched off in Settings");
  } else if (!payload.settings.teams_webhook_url) {
    results.teams = "unconfigured";
    await log("teams", "skipped", "No Teams webhook URL is set in Settings");
  } else {
    try {
      const response = await fetch(payload.settings.teams_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adaptiveCard(kind, payload, link)),
      });
      if (response.ok) {
        results.teams = "sent";
        await log("teams", "sent", `Posted to Teams (${response.status})`);
      } else {
        results.teams = "failed";
        await log("teams", "failed", `Teams returned ${response.status}: ${await response.text()}`);
      }
    } catch (cause) {
      results.teams = "failed";
      await log("teams", "failed", String(cause));
    }
  }

  // ---------------------------------------------------------------- Email
  if (!payload.settings.notify_email_enabled) {
    results.email = "disabled";
    await log("email", "skipped", "Email notifications are switched off in Settings");
  } else if (!payload.settings.it_distribution_email) {
    results.email = "unconfigured";
    await log("email", "skipped", "No IT distribution address is set in Settings");
  } else {
    try {
      const outcome = await sendEmail(
        payload.settings.it_distribution_email,
        `[${payload.ticket.ticket_number}] ${HEADLINE[kind]}: ${payload.ticket.subject}`,
        emailBody(kind, payload, link),
      );
      results.email = outcome.status;
      await log("email", outcome.status, outcome.detail);
    } catch (cause) {
      results.email = "failed";
      await log("email", "failed", String(cause));
    }
  }

  return new Response(JSON.stringify({ ok: true, kind, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

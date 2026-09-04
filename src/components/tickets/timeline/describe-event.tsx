import { PRIORITY_META, STATUS_META } from "@/lib/constants";
import type { TicketPriority, TicketStatus } from "@/lib/database.types";
import type { EventWithActor } from "./types";

/** Events that only restate a message already shown as a bubble. */
export const HIDDEN_EVENTS = new Set(["commented"]);

/** Which rail marker an event earns. Only real trouble gets a colour. */
export function eventTone(event: EventWithActor): "neutral" | "warn" | "fail" | "ok" {
  switch (event.event_type) {
    case "sla_breached":
      return "fail";
    case "escalated":
      return "warn";
    case "status_changed":
      return event.to_value === "resolved" || event.to_value === "closed" ? "ok" : "neutral";
    default:
      return "neutral";
  }
}

export function describeEvent(event: EventWithActor, names: Map<string, string>) {
  const actor = event.actor?.full_name ?? "The system";

  switch (event.event_type) {
    case "created":
      return <>{actor} opened this ticket</>;

    case "status_changed": {
      const to = STATUS_META[event.to_value as TicketStatus];
      const from = STATUS_META[event.from_value as TicketStatus];
      return (
        <>
          {actor} moved it from{" "}
          <span className="text-ink-muted">{from?.label ?? event.from_value}</span> to{" "}
          <span className="font-medium text-ink">{to?.label ?? event.to_value}</span>
        </>
      );
    }

    case "assigned":
      return (
        <>
          {actor} assigned it to{" "}
          <span className="font-medium text-ink">
            {names.get(event.to_value ?? "") ?? "an agent"}
          </span>
        </>
      );

    case "unassigned":
      return <>{actor} removed the assignee</>;

    case "priority_changed": {
      const to = PRIORITY_META[event.to_value as TicketPriority];
      return (
        <>
          {actor} set priority to{" "}
          <span className="font-medium text-ink">{to?.label ?? event.to_value}</span>
        </>
      );
    }

    case "escalated":
      return <>Escalated — still unassigned past the configured threshold</>;

    case "sla_breached":
      return <>SLA target passed while the ticket was still open</>;

    default:
      return <>{event.event_type.replace(/_/g, " ")}</>;
  }
}

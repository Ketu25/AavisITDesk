export type ReportSummary = {
  range: { from: string; to: string };
  totals: {
    total: number;
    open: number;
    resolved: number;
    closed: number;
    unassigned: number;
    breached: number;
    reopened: number;
    avg_resolution_minutes: number | null;
    avg_first_response_minutes: number | null;
  };
  by_department: { label: string; count: number; avg_resolution_minutes: number | null }[];
  by_category: { label: string; count: number }[];
  by_priority: { label: string; count: number }[];
  by_status: { label: string; count: number }[];
  daily: { date: string; created: number; resolved: number }[];
  agents: {
    label: string;
    open: number;
    resolved: number;
    avg_resolution_minutes: number | null;
  }[];
};

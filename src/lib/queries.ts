/** The join shape every ticket list and detail view selects. */
export const TICKET_SELECT = `
  *,
  department:departments(name),
  creator:profiles!tickets_created_by_fkey(id, full_name, email),
  assignee:profiles!tickets_assigned_to_fkey(id, full_name, email)
` as const;

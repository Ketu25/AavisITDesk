insert into public.departments (name, sort_order) values
  ('QA', 10), ('QC', 20), ('Finance', 30), ('Manufacturing', 40), ('Warehouse', 50),
  ('IT', 60), ('Front Desk', 70), ('HR', 80), ('CEO', 90), ('President', 100), ('Maintenance', 110)
on conflict do nothing;

insert into public.sla_rules (priority, duration_minutes, at_risk_threshold_pct) values
  ('urgent',  120, 60),
  ('high',    480, 70),
  ('normal', 1440, 75),
  ('low',    4320, 80)
on conflict (priority) do nothing;

insert into public.routing_rules (category, description, sort_order, default_priority) values
  ('Hardware',              'Laptops, desktops, peripherals, docking stations',      10, null),
  ('Software',              'Application installs, licences, crashes, updates',      20, null),
  ('Network & Connectivity','Wi-Fi, VPN, LAN drops, slow connections',               30, 'high'),
  ('Account & Access',      'Password resets, permissions, shared drive access',     40, null),
  ('Email',                 'Outlook, distribution lists, spam and delivery issues', 50, null),
  ('Printing & Scanning',   'Printers, label printers, scanners, copiers',           60, null),
  ('ERP / Business System', 'Core business system errors and data issues',           70, 'high'),
  ('Phone & Conferencing',  'Desk phones, Teams calls, meeting room equipment',      80, null),
  ('Security Incident',     'Phishing, malware, lost device, suspected breach',      90, 'urgent'),
  ('Facilities Equipment',  'Badge readers, cameras, shop-floor terminals',         100, null),
  ('Other',                 'Anything that does not fit the categories above',      110, 'low')
on conflict do nothing;

insert into public.app_settings (
  id, allowed_email_domains, invite_expiry_hours, auto_assign_strategy,
  escalation_unassigned_minutes, notify_email_enabled, notify_teams_enabled, app_base_url
) values (
  true, array['aavispharma.com'], 48, 'least_busy', 60, true, true, 'http://localhost:3000'
)
on conflict (id) do nothing;

-- Bootstrap exception: the first admin signs in with a non-company address.
insert into public.email_allowlist (email, note) values
  ('aavisitdesk@gmail.com', 'Bootstrap administrator account')
on conflict do nothing;

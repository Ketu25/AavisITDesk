// Generated from the live Supabase schema. Regenerate after any migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      app_settings: {
        Row: {
          allowed_email_domains: string[];
          app_base_url: string | null;
          auto_assign_strategy: string;
          escalation_lead_id: string | null;
          escalation_unassigned_minutes: number;
          id: boolean;
          invite_expiry_hours: number;
          it_distribution_email: string | null;
          notify_email_enabled: boolean;
          notify_teams_enabled: boolean;
          teams_webhook_url: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["app_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "app_settings_escalation_lead_id_fkey";
            columns: ["escalation_lead_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "app_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: { created_at: string; id: string; is_active: boolean; name: string; sort_order: number };
        Insert: { created_at?: string; id?: string; is_active?: boolean; name: string; sort_order?: number };
        Update: { created_at?: string; id?: string; is_active?: boolean; name?: string; sort_order?: number };
        Relationships: [];
      };
      email_allowlist: {
        Row: { added_by: string | null; created_at: string; email: string; id: string; note: string | null };
        Insert: { added_by?: string | null; created_at?: string; email: string; id?: string; note?: string | null };
        Update: { added_by?: string | null; created_at?: string; email?: string; id?: string; note?: string | null };
        Relationships: [
          {
            foreignKeyName: "email_allowlist_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_log: {
        Row: {
          channel: string; created_at: string; detail: string | null;
          id: string; kind: string; status: string; ticket_id: string | null;
        };
        Insert: {
          channel: string; created_at?: string; detail?: string | null;
          id?: string; kind: string; status: string; ticket_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notification_log"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "notification_log_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          activated_at: string | null;
          created_at: string;
          department_id: string | null;
          disabled_at: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          last_invite_sent_at: string | null;
          must_change_password: boolean;
          temp_password_expires_at: string | null;
          temp_password_fingerprint: string | null;
          password_set_at: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["user_status"];
          updated_at: string;
        };
        Insert: {
          activated_at?: string | null;
          created_at?: string;
          department_id?: string | null;
          disabled_at?: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at?: string | null;
          invited_by?: string | null;
          last_invite_sent_at?: string | null;
          must_change_password?: boolean;
          temp_password_expires_at?: string | null;
          temp_password_fingerprint?: string | null;
          password_set_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["user_status"];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      routing_rules: {
        Row: {
          category: string;
          created_at: string;
          default_assignee_id: string | null;
          default_department_id: string | null;
          default_priority: Database["public"]["Enums"]["ticket_priority"] | null;
          description: string | null;
          id: string;
          is_active: boolean;
          sort_order: number;
        };
        Insert: {
          category: string;
          created_at?: string;
          default_assignee_id?: string | null;
          default_department_id?: string | null;
          default_priority?: Database["public"]["Enums"]["ticket_priority"] | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["routing_rules"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "routing_rules_default_assignee_id_fkey";
            columns: ["default_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "routing_rules_default_department_id_fkey";
            columns: ["default_department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_rules: {
        Row: {
          at_risk_threshold_pct: number;
          duration_minutes: number;
          id: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          updated_at: string;
        };
        Insert: {
          at_risk_threshold_pct?: number;
          duration_minutes: number;
          id?: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sla_rules"]["Row"]>;
        Relationships: [];
      };
      ticket_comments: {
        Row: {
          author_id: string | null; created_at: string; id: string;
          is_internal: boolean; message: string; ticket_id: string;
        };
        Insert: {
          author_id?: string | null; created_at?: string; id?: string;
          is_internal?: boolean; message: string; ticket_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["ticket_comments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "ticket_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_events: {
        Row: {
          actor_id: string | null; created_at: string; event_type: string;
          from_value: string | null; id: string; metadata: Json;
          ticket_id: string; to_value: string | null;
        };
        Insert: {
          actor_id?: string | null; created_at?: string; event_type: string;
          from_value?: string | null; id?: string; metadata?: Json;
          ticket_id: string; to_value?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ticket_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "ticket_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          assigned_to: string | null;
          category: string;
          closed_at: string | null;
          created_at: string;
          created_by: string;
          department_id: string | null;
          description: string;
          first_response_at: string | null;
          id: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          reopen_count: number;
          resolved_at: string | null;
          sla_due_at: string | null;
          sla_paused_at: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          ticket_number: string;
          updated_at: string;
          work_started_at: string | null;
        };
        Insert: {
          assigned_to?: string | null;
          category: string;
          created_by: string;
          department_id?: string | null;
          description: string;
          id?: string;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          status?: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          ticket_number?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tickets"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      auto_assign_ticket: { Args: { p_ticket_id: string }; Returns: string };
      get_notification_endpoint: { Args: never; Returns: Json };
      set_notification_endpoint: { Args: { p_url: string }; Returns: Json };
      rotate_notification_secret: { Args: never; Returns: Json };
      current_profile_role: { Args: never; Returns: Database["public"]["Enums"]["user_role"] };
      is_active_user: { Args: never; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_agent: { Args: never; Returns: boolean };
      is_email_allowed: { Args: { p_email: string }; Returns: boolean };
      report_summary: { Args: { p_from?: string; p_to?: string }; Returns: Json };
      reset_invite_state: { Args: { p_user_id: string }; Returns: boolean };
      temp_password_is_valid: { Args: { p_user_id: string }; Returns: boolean };
      stamp_temp_password: { Args: { p_user_id: string; p_expires: string }; Returns: undefined };
      complete_activation: { Args: never; Returns: Json };
      run_sla_escalation: { Args: never; Returns: Json };
      sla_duration: { Args: { p_priority: Database["public"]["Enums"]["ticket_priority"] }; Returns: string };
    };
    Enums: {
      ticket_priority: "low" | "normal" | "high" | "urgent";
      ticket_status: "new" | "assigned" | "in_progress" | "waiting_on_user" | "resolved" | "closed" | "reopened";
      user_role: "user" | "agent" | "admin";
      user_status: "pending" | "active" | "disabled";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

// -- convenience aliases used throughout the app ----------------------------
type T = Database["public"]["Tables"];
export type Profile        = T["profiles"]["Row"];
export type Department     = T["departments"]["Row"];
export type Ticket         = T["tickets"]["Row"];
export type TicketComment  = T["ticket_comments"]["Row"];
export type TicketEvent    = T["ticket_events"]["Row"];
export type SlaRule        = T["sla_rules"]["Row"];
export type RoutingRule    = T["routing_rules"]["Row"];
export type AppSettings    = T["app_settings"]["Row"];
export type EmailAllowlist = T["email_allowlist"]["Row"];

export type UserRole       = Database["public"]["Enums"]["user_role"];
export type UserStatus     = Database["public"]["Enums"]["user_status"];
export type TicketStatus   = Database["public"]["Enums"]["ticket_status"];
export type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

export const TICKET_STATUSES: TicketStatus[] = [
  "new", "assigned", "in_progress", "waiting_on_user", "resolved", "closed", "reopened",
];
export const TICKET_PRIORITIES: TicketPriority[] = ["urgent", "high", "normal", "low"];
export const USER_ROLES: UserRole[] = ["user", "agent", "admin"];
export const USER_STATUSES: UserStatus[] = ["pending", "active", "disabled"];

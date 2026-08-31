export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          payload: Json
          sender: string
          session_id: string
          turn: number
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          sender: string
          session_id: string
          turn?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          sender?: string
          session_id?: string
          turn?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          brief: string
          created_at: string
          id: string
          mandate: Json
          origin: string
          outcome: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brief: string
          created_at?: string
          id?: string
          mandate?: Json
          origin?: string
          outcome?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brief?: string
          created_at?: string
          id?: string
          mandate?: Json
          origin?: string
          outcome?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          actor: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          seq: number
          session_id: string | null
          summary: string
        }
        Insert: {
          actor: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          seq?: number
          session_id?: string | null
          summary?: string
        }
        Update: {
          actor?: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          seq?: number
          session_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_paise: number
          attempts: number
          cart: Json
          created_at: string
          currency: string
          discount_paise: number
          external_reference: string | null
          failure_reason: string | null
          id: string
          razorpay_link_url: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          session_id: string | null
          status: string
          subtotal_paise: number
          updated_at: string
        }
        Insert: {
          amount_paise?: number
          attempts?: number
          cart?: Json
          created_at?: string
          currency?: string
          discount_paise?: number
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          razorpay_link_url?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          session_id?: string | null
          status?: string
          subtotal_paise?: number
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          attempts?: number
          cart?: Json
          created_at?: string
          currency?: string
          discount_paise?: number
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          razorpay_link_url?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          session_id?: string | null
          status?: string
          subtotal_paise?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_caps: {
        Row: {
          allowed_categories: string[]
          created_at: string
          id: string
          max_discount_bps: number
          max_item_price_paise: number
          max_order_total_paise: number
          max_payment_attempts: number
          scope: string
          updated_at: string
        }
        Insert: {
          allowed_categories?: string[]
          created_at?: string
          id?: string
          max_discount_bps: number
          max_item_price_paise: number
          max_order_total_paise: number
          max_payment_attempts: number
          scope: string
          updated_at?: string
        }
        Update: {
          allowed_categories?: string[]
          created_at?: string
          id?: string
          max_discount_bps?: number
          max_item_price_paise?: number
          max_order_total_paise?: number
          max_payment_attempts?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      policy_decisions: {
        Row: {
          action: string
          actor: string
          created_at: string
          id: string
          inputs: Json
          reason: string
          rule_name: string
          session_id: string
          verdict: string
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          id?: string
          inputs?: Json
          reason?: string
          rule_name: string
          session_id: string
          verdict: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          id?: string
          inputs?: Json
          reason?: string
          rule_name?: string
          session_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          image_url: string | null
          price_paise: number
          sku: string
          stock: number
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          price_paise: number
          sku: string
          stock?: number
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          price_paise?: number
          sku?: string
          stock?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      upsell_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_discount_bps: number
          rationale: string
          suggested_sku: string
          trigger_category: string | null
          trigger_sku: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_discount_bps?: number
          rationale?: string
          suggested_sku: string
          trigger_category?: string | null
          trigger_sku?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_discount_bps?: number
          rationale?: string
          suggested_sku?: string
          trigger_category?: string | null
          trigger_sku?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

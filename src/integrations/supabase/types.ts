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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      content_requests: {
        Row: {
          admin_notes: string | null
          category: Database["public"]["Enums"]["content_category"] | null
          created_at: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["request_status"]
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          category?: Database["public"]["Enums"]["content_category"] | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          category?: Database["public"]["Enums"]["content_category"] | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      download_logs: {
        Row: {
          created_at: string
          file_id: string | null
          id: string
          source: string | null
          title_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          file_id?: string | null
          id?: string
          source?: string | null
          title_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          file_id?: string | null
          id?: string
          source?: string | null
          title_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "download_logs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_logs_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      episodes: {
        Row: {
          air_date: string | null
          created_at: string
          episode_number: number
          id: string
          name: string | null
          overview: string | null
          runtime_minutes: number | null
          season_id: string
          still_url: string | null
          title_id: string
          updated_at: string
        }
        Insert: {
          air_date?: string | null
          created_at?: string
          episode_number: number
          id?: string
          name?: string | null
          overview?: string | null
          runtime_minutes?: number | null
          season_id: string
          still_url?: string | null
          title_id: string
          updated_at?: string
        }
        Update: {
          air_date?: string | null
          created_at?: string
          episode_number?: number
          id?: string
          name?: string | null
          overview?: string | null
          runtime_minutes?: number | null
          season_id?: string
          still_url?: string | null
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_titles: {
        Row: {
          backdrop_url: string | null
          cast_names: string[] | null
          category: Database["public"]["Enums"]["content_category"]
          created_at: string
          download_count: number
          genres: string[] | null
          id: string
          imdb_id: string | null
          is_featured: boolean
          is_trending: boolean
          language: string | null
          original_title: string | null
          overview: string | null
          poster_url: string | null
          rating: number | null
          release_date: string | null
          release_year: number | null
          runtime_minutes: number | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
          tmdb_id: number | null
          trailer_url: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          backdrop_url?: string | null
          cast_names?: string[] | null
          category: Database["public"]["Enums"]["content_category"]
          created_at?: string
          download_count?: number
          genres?: string[] | null
          id?: string
          imdb_id?: string | null
          is_featured?: boolean
          is_trending?: boolean
          language?: string | null
          original_title?: string | null
          overview?: string | null
          poster_url?: string | null
          rating?: number | null
          release_date?: string | null
          release_year?: number | null
          runtime_minutes?: number | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          tmdb_id?: number | null
          trailer_url?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          backdrop_url?: string | null
          cast_names?: string[] | null
          category?: Database["public"]["Enums"]["content_category"]
          created_at?: string
          download_count?: number
          genres?: string[] | null
          id?: string
          imdb_id?: string | null
          is_featured?: boolean
          is_trending?: boolean
          language?: string | null
          original_title?: string | null
          overview?: string | null
          poster_url?: string | null
          rating?: number | null
          release_date?: string | null
          release_year?: number | null
          runtime_minutes?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          tmdb_id?: number | null
          trailer_url?: string | null
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      media_files: {
        Row: {
          caption: string | null
          channel_id: string | null
          created_at: string
          duration_seconds: number | null
          episode_id: string | null
          file_name: string
          file_size: number | null
          id: string
          is_active: boolean
          language: string | null
          mime_type: string | null
          quality: string | null
          resolution: string | null
          telegram_file_id: string
          telegram_message_id: number | null
          title_id: string | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          channel_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          is_active?: boolean
          language?: string | null
          mime_type?: string | null
          quality?: string | null
          resolution?: string | null
          telegram_file_id: string
          telegram_message_id?: number | null
          title_id?: string | null
          updated_at?: string
        }
        Update: {
          caption?: string | null
          channel_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          is_active?: boolean
          language?: string | null
          mime_type?: string | null
          quality?: string | null
          resolution?: string | null
          telegram_file_id?: string
          telegram_message_id?: number | null
          title_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_files_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "telegram_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          air_date: string | null
          created_at: string
          episode_count: number
          id: string
          name: string | null
          overview: string | null
          poster_url: string | null
          season_number: number
          title_id: string
          updated_at: string
        }
        Insert: {
          air_date?: string | null
          created_at?: string
          episode_count?: number
          id?: string
          name?: string | null
          overview?: string | null
          poster_url?: string | null
          season_number: number
          title_id: string
          updated_at?: string
        }
        Update: {
          air_date?: string | null
          created_at?: string
          episode_count?: number
          id?: string
          name?: string | null
          overview?: string | null
          poster_url?: string | null
          season_number?: number
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_channels: {
        Row: {
          channel_id: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          updated_at: string
          username: string | null
        }
        Insert: {
          channel_id: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          channel_id?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      content_category:
        | "movie"
        | "series"
        | "anime"
        | "cartoon"
        | "kdrama"
        | "documentary"
      content_status: "draft" | "published" | "archived"
      request_status: "pending" | "approved" | "rejected" | "fulfilled"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
      content_category: [
        "movie",
        "series",
        "anime",
        "cartoon",
        "kdrama",
        "documentary",
      ],
      content_status: ["draft", "published", "archived"],
      request_status: ["pending", "approved", "rejected", "fulfilled"],
    },
  },
} as const

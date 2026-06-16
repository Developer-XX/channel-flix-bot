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
      auth_rate_limits: {
        Row: {
          action: string
          attempts: number
          blocked_until: string | null
          last_attempt_at: string
          rate_key: string
          window_start: string
        }
        Insert: {
          action: string
          attempts?: number
          blocked_until?: string | null
          last_attempt_at?: string
          rate_key: string
          window_start?: string
        }
        Update: {
          action?: string
          attempts?: number
          blocked_until?: string | null
          last_attempt_at?: string
          rate_key?: string
          window_start?: string
        }
        Relationships: []
      }
      bulk_job_runs: {
        Row: {
          created_at: string
          created_by: string | null
          failed: number
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          params: Json
          processed: number
          promoted: number
          started_at: string
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          params?: Json
          processed?: number
          promoted?: number
          started_at?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          params?: Json
          processed?: number
          promoted?: number
          started_at?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
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
      delivery_attempts: {
        Row: {
          attempt_no: number
          bot_user_id: number | null
          created_at: string
          error: string | null
          history: Json
          id: string
          idempotency_key: string
          media_file_id: string
          status: string
          telegram_message_id: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_no?: number
          bot_user_id?: number | null
          created_at?: string
          error?: string | null
          history?: Json
          id?: string
          idempotency_key: string
          media_file_id: string
          status?: string
          telegram_message_id?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_no?: number
          bot_user_id?: number | null
          created_at?: string
          error?: string | null
          history?: Json
          id?: string
          idempotency_key?: string
          media_file_id?: string
          status?: string
          telegram_message_id?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_attempts_media_file_id_fkey"
            columns: ["media_file_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
        ]
      }
      download_logs: {
        Row: {
          attempt_count: number
          attempt_history: Json
          bot_user_id: number | null
          created_at: string
          delivered_at: string | null
          delivery_error: string | null
          delivery_status: string | null
          file_id: string | null
          id: string
          idempotency_key: string | null
          source: string | null
          title_id: string | null
          user_id: string | null
          verification_provider: string | null
          verification_status: string | null
        }
        Insert: {
          attempt_count?: number
          attempt_history?: Json
          bot_user_id?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          file_id?: string | null
          id?: string
          idempotency_key?: string | null
          source?: string | null
          title_id?: string | null
          user_id?: string | null
          verification_provider?: string | null
          verification_status?: string | null
        }
        Update: {
          attempt_count?: number
          attempt_history?: Json
          bot_user_id?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          file_id?: string | null
          id?: string
          idempotency_key?: string | null
          source?: string | null
          title_id?: string | null
          user_id?: string | null
          verification_provider?: string | null
          verification_status?: string | null
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
      idx_latest_releases: {
        Row: {
          media_file_id: string
          promoted_at: string
          rank: number
          title_id: string
        }
        Insert: {
          media_file_id: string
          promoted_at: string
          rank: number
          title_id: string
        }
        Update: {
          media_file_id?: string
          promoted_at?: string
          rank?: number
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idx_latest_releases_media_file_id_fkey"
            columns: ["media_file_id"]
            isOneToOne: true
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idx_latest_releases_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      idx_search: {
        Row: {
          category: string | null
          poster_url: string | null
          refreshed_at: string
          release_year: number | null
          searchable: unknown
          searchable_text: string
          slug: string
          title: string
          title_id: string
        }
        Insert: {
          category?: string | null
          poster_url?: string | null
          refreshed_at?: string
          release_year?: number | null
          searchable?: unknown
          searchable_text?: string
          slug: string
          title: string
          title_id: string
        }
        Update: {
          category?: string | null
          poster_url?: string | null
          refreshed_at?: string
          release_year?: number | null
          searchable?: unknown
          searchable_text?: string
          slug?: string
          title?: string
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idx_search_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: true
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      idx_trending: {
        Row: {
          computed_at: string
          download_count_7d: number
          rank: number
          score: number
          title_id: string
        }
        Insert: {
          computed_at?: string
          download_count_7d?: number
          rank: number
          score: number
          title_id: string
        }
        Update: {
          computed_at?: string
          download_count_7d?: number
          rank?: number
          score?: number
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idx_trending_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: true
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
      match_audit_log: {
        Row: {
          actor: string
          attempt_at: string
          decision: string
          id: string
          master_title_id: string | null
          parsed_snapshot: Json | null
          reason: string | null
          rules_used: Json
          scores: Json
          telegram_ingest_id: string | null
          threshold: number | null
        }
        Insert: {
          actor?: string
          attempt_at?: string
          decision: string
          id?: string
          master_title_id?: string | null
          parsed_snapshot?: Json | null
          reason?: string | null
          rules_used?: Json
          scores?: Json
          telegram_ingest_id?: string | null
          threshold?: number | null
        }
        Update: {
          actor?: string
          attempt_at?: string
          decision?: string
          id?: string
          master_title_id?: string | null
          parsed_snapshot?: Json | null
          reason?: string | null
          rules_used?: Json
          scores?: Json
          telegram_ingest_id?: string | null
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_audit_log_master_title_id_fkey"
            columns: ["master_title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_audit_log_telegram_ingest_id_fkey"
            columns: ["telegram_ingest_id"]
            isOneToOne: false
            referencedRelation: "telegram_ingest"
            referencedColumns: ["id"]
          },
        ]
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
      telegram_bot_state: {
        Row: {
          admin_telegram_user_ids: number[]
          auto_rebuild_threshold: number
          cache_version: number
          id: string
          indexes_rebuilding_at: string | null
          indexes_rebuilt_at: string | null
          last_run_at: string | null
          last_run_error: string | null
          last_run_status: string | null
          last_update_id: number
          matching_settings: Json
          pending_index_rebuild: boolean
          promotions_since_last_index: number
          updated_at: string
        }
        Insert: {
          admin_telegram_user_ids?: number[]
          auto_rebuild_threshold?: number
          cache_version?: number
          id: string
          indexes_rebuilding_at?: string | null
          indexes_rebuilt_at?: string | null
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          last_update_id?: number
          matching_settings?: Json
          pending_index_rebuild?: boolean
          promotions_since_last_index?: number
          updated_at?: string
        }
        Update: {
          admin_telegram_user_ids?: number[]
          auto_rebuild_threshold?: number
          cache_version?: number
          id?: string
          indexes_rebuilding_at?: string | null
          indexes_rebuilt_at?: string | null
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          last_update_id?: number
          matching_settings?: Json
          pending_index_rebuild?: boolean
          promotions_since_last_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_channels: {
        Row: {
          channel_id: number
          confirm_with_reply: boolean
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
          confirm_with_reply?: boolean
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
          confirm_with_reply?: boolean
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
      telegram_ingest: {
        Row: {
          caption: string | null
          channel_id: string | null
          created_at: string
          duration_seconds: number | null
          file_name: string | null
          file_size: number | null
          id: string
          last_error: string | null
          match_score: number | null
          match_status: Database["public"]["Enums"]["ingest_status"]
          matched_title_id: string | null
          mime_type: string | null
          parsed_category:
            | Database["public"]["Enums"]["content_category"]
            | null
          parsed_codec: string | null
          parsed_episode: number | null
          parsed_language: string | null
          parsed_quality: string | null
          parsed_resolution: string | null
          parsed_season: number | null
          parsed_title: string | null
          parsed_year: number | null
          promoted_media_file_id: string | null
          raw_update: Json
          telegram_channel_id: number
          telegram_file_id: string | null
          telegram_file_unique_id: string | null
          telegram_message_id: number
          update_id: number | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          channel_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          last_error?: string | null
          match_score?: number | null
          match_status?: Database["public"]["Enums"]["ingest_status"]
          matched_title_id?: string | null
          mime_type?: string | null
          parsed_category?:
            | Database["public"]["Enums"]["content_category"]
            | null
          parsed_codec?: string | null
          parsed_episode?: number | null
          parsed_language?: string | null
          parsed_quality?: string | null
          parsed_resolution?: string | null
          parsed_season?: number | null
          parsed_title?: string | null
          parsed_year?: number | null
          promoted_media_file_id?: string | null
          raw_update: Json
          telegram_channel_id: number
          telegram_file_id?: string | null
          telegram_file_unique_id?: string | null
          telegram_message_id: number
          update_id?: number | null
          updated_at?: string
        }
        Update: {
          caption?: string | null
          channel_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          last_error?: string | null
          match_score?: number | null
          match_status?: Database["public"]["Enums"]["ingest_status"]
          matched_title_id?: string | null
          mime_type?: string | null
          parsed_category?:
            | Database["public"]["Enums"]["content_category"]
            | null
          parsed_codec?: string | null
          parsed_episode?: number | null
          parsed_language?: string | null
          parsed_quality?: string | null
          parsed_resolution?: string | null
          parsed_season?: number | null
          parsed_title?: string | null
          parsed_year?: number | null
          promoted_media_file_id?: string | null
          raw_update?: Json
          telegram_channel_id?: number
          telegram_file_id?: string | null
          telegram_file_unique_id?: string | null
          telegram_message_id?: number
          update_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_ingest_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "telegram_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_ingest_matched_title_id_fkey"
            columns: ["matched_title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_ingest_promoted_media_file_id_fkey"
            columns: ["promoted_media_file_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_user_links: {
        Row: {
          created_at: string
          link_code: string | null
          link_code_expires_at: string | null
          linked_at: string | null
          telegram_first_name: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          telegram_first_name?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          telegram_first_name?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_webhook_events: {
        Row: {
          error: string | null
          received_at: string
          source: string
          status: string
          telegram_channel_id: number | null
          telegram_message_id: number | null
          update_id: number
        }
        Insert: {
          error?: string | null
          received_at?: string
          source?: string
          status?: string
          telegram_channel_id?: number | null
          telegram_message_id?: number | null
          update_id: number
        }
        Update: {
          error?: string | null
          received_at?: string
          source?: string
          status?: string
          telegram_channel_id?: number | null
          telegram_message_id?: number | null
          update_id?: number
        }
        Relationships: []
      }
      title_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          normalized_alias: string
          title_id: string
          updated_at: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          normalized_alias: string
          title_id: string
          updated_at?: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          normalized_alias?: string
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_aliases_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "master_titles"
            referencedColumns: ["id"]
          },
        ]
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
      user_verifications: {
        Row: {
          expires_at: string | null
          last_provider: string | null
          updated_at: string
          user_id: string
          verification_count: number
          verified_at: string | null
        }
        Insert: {
          expires_at?: string | null
          last_provider?: string | null
          updated_at?: string
          user_id: string
          verification_count?: number
          verified_at?: string | null
        }
        Update: {
          expires_at?: string | null
          last_provider?: string | null
          updated_at?: string
          user_id?: string
          verification_count?: number
          verified_at?: string | null
        }
        Relationships: []
      }
      verification_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          ip_hash: string | null
          media_file_id: string | null
          provider: string
          token: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          ip_hash?: string | null
          media_file_id?: string | null
          provider: string
          token: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          ip_hash?: string | null
          media_file_id?: string | null
          provider?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_tokens_media_file_id_fkey"
            columns: ["media_file_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
        ]
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
      ingest_status: "pending" | "matched" | "unmatched" | "ignored"
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
      ingest_status: ["pending", "matched", "unmatched", "ignored"],
      request_status: ["pending", "approved", "rejected", "fulfilled"],
    },
  },
} as const

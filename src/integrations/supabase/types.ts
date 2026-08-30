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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      agent_runs_v: {
        Row: {
          agent: string | null
          cost: number | null
          created_at: string | null
          created_by: string | null
          error: string | null
          id: string | null
          latency_ms: number | null
          model: string | null
          piece_id: string | null
          sovereign: boolean | null
          status: string | null
          tenant_id: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          agent?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string | null
          latency_ms?: number | null
          model?: string | null
          piece_id?: string | null
          sovereign?: boolean | null
          status?: string | null
          tenant_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          agent?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string | null
          latency_ms?: number | null
          model?: string | null
          piece_id?: string | null
          sovereign?: boolean | null
          status?: string | null
          tenant_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: []
      }
      agents_model_pricing_v: {
        Row: {
          currency: string | null
          effective_from: string | null
          effective_to: string | null
          id: string | null
          model: string | null
          price_in_per_mtok: number | null
          price_out_per_mtok: number | null
          provider: string | null
          role: string | null
          sovereign: boolean | null
        }
        Insert: {
          currency?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          model?: string | null
          price_in_per_mtok?: number | null
          price_out_per_mtok?: number | null
          provider?: string | null
          role?: string | null
          sovereign?: boolean | null
        }
        Update: {
          currency?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          model?: string | null
          price_in_per_mtok?: number | null
          price_out_per_mtok?: number | null
          provider?: string | null
          role?: string | null
          sovereign?: boolean | null
        }
        Relationships: []
      }
      banque_comptes_v: {
        Row: {
          account_code: string | null
          active: boolean | null
          created_at: string | null
          devise: string | null
          entity_id: string | null
          iban: string | null
          id: string | null
          label: string | null
          tenant_id: string | null
          updated_at: string | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          account_code?: string | null
          active?: boolean | null
          created_at?: string | null
          devise?: string | null
          entity_id?: string | null
          iban?: string | null
          id?: string | null
          label?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          account_code?: string | null
          active?: boolean | null
          created_at?: string | null
          devise?: string | null
          entity_id?: string | null
          iban?: string | null
          id?: string | null
          label?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      banque_lettrage_etat_v: {
        Row: {
          active: boolean | null
          ecart_jours: number | null
          ecart_montant: number | null
          ecriture_id: string | null
          ligne_id: string | null
          pack_version_id: string | null
          reference_exacte: boolean | null
          score: number | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          ligne_id?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          ligne_id?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      banque_lettrages_v: {
        Row: {
          action: string | null
          created_at: string | null
          decided_by: string | null
          ecart_jours: number | null
          ecart_montant: number | null
          ecriture_id: string | null
          id: string | null
          ligne_id: string | null
          motif_id: string | null
          note: string | null
          pack_version_id: string | null
          reference_exacte: boolean | null
          score: number | null
          seq: number | null
          tenant_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          decided_by?: string | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          id?: string | null
          ligne_id?: string | null
          motif_id?: string | null
          note?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          seq?: number | null
          tenant_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          decided_by?: string | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          id?: string | null
          ligne_id?: string | null
          motif_id?: string | null
          note?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          seq?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      banque_lignes_v: {
        Row: {
          at: string | null
          compte_id: string | null
          created_at: string | null
          id: string | null
          idempotency_key: string | null
          import_batch: string | null
          label: string | null
          montant: number | null
          reference: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          at?: string | null
          compte_id?: string | null
          created_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          import_batch?: string | null
          label?: string | null
          montant?: number | null
          reference?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          at?: string | null
          compte_id?: string | null
          created_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          import_batch?: string | null
          label?: string | null
          montant?: number | null
          reference?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      banque_rapprochements_v: {
        Row: {
          created_at: string | null
          decided_by: string | null
          ecart_jours: number | null
          ecart_montant: number | null
          ecriture_id: string | null
          id: string | null
          ligne_id: string | null
          motif_id: string | null
          pack_version_id: string | null
          reference_exacte: boolean | null
          score: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          decided_by?: string | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          id?: string | null
          ligne_id?: string | null
          motif_id?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          decided_by?: string | null
          ecart_jours?: number | null
          ecart_montant?: number | null
          ecriture_id?: string | null
          id?: string | null
          ligne_id?: string | null
          motif_id?: string | null
          pack_version_id?: string | null
          reference_exacte?: boolean | null
          score?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      cabinet_members_v: {
        Row: {
          email: string | null
          role: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      cabinet_stats_v: {
        Row: {
          capturees: number | null
          comptabilisees: number | null
          derniere_piece: string | null
          heures_moyennes: number | null
          lues: number | null
          pieces: number | null
          proposees: number | null
          retournees: number | null
          supervisees: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      charge_questions_v: {
        Row: {
          answer: string | null
          answered_at: string | null
          baseline: number | null
          courante: boolean | null
          created_at: string | null
          deviation_ratio: number | null
          famille_code: string | null
          id: string | null
          observed: number | null
          pack_version_id: string | null
          period: string | null
          seq: number | null
          tenant_id: string | null
          threshold_code: string | null
          vis: "personnel" | "partage" | null
        }
        Relationships: []
      }
      citations_v: {
        Row: {
          bbox: Json | null
          created_at: string | null
          field: string | null
          id: string | null
          page: number | null
          piece_id: string | null
          tenant_id: string | null
          token_id: string | null
          ui_field: string | null
          ui_role: string | null
          zone: string | null
        }
        Insert: {
          bbox?: Json | null
          created_at?: string | null
          field?: string | null
          id?: string | null
          page?: number | null
          piece_id?: string | null
          tenant_id?: string | null
          token_id?: string | null
          ui_field?: string | null
          ui_role?: string | null
          zone?: string | null
        }
        Update: {
          bbox?: Json | null
          created_at?: string | null
          field?: string | null
          id?: string | null
          page?: number | null
          piece_id?: string | null
          tenant_id?: string | null
          token_id?: string | null
          ui_field?: string | null
          ui_role?: string | null
          zone?: string | null
        }
        Relationships: []
      }
      collab_assignments_v: {
        Row: {
          active: boolean | null
          briefing: string | null
          cabinet_tenant_id: string | null
          client_tenant_id: string | null
          collaborator_id: string | null
          created_at: string | null
          decided_by: string | null
          id: string | null
          seq: number | null
        }
        Insert: {
          active?: boolean | null
          briefing?: string | null
          cabinet_tenant_id?: string | null
          client_tenant_id?: string | null
          collaborator_id?: string | null
          created_at?: string | null
          decided_by?: string | null
          id?: string | null
          seq?: number | null
        }
        Update: {
          active?: boolean | null
          briefing?: string | null
          cabinet_tenant_id?: string | null
          client_tenant_id?: string | null
          collaborator_id?: string | null
          created_at?: string | null
          decided_by?: string | null
          id?: string | null
          seq?: number | null
        }
        Relationships: []
      }
      collab_pv_v: {
        Row: {
          at: string | null
          cabinet_tenant_id: string | null
          client_tenant_id: string | null
          created_at: string | null
          created_by: string | null
          decisions: string | null
          id: string | null
          ordre_du_jour: string | null
          participants: string | null
          titre: string | null
        }
        Insert: {
          at?: string | null
          cabinet_tenant_id?: string | null
          client_tenant_id?: string | null
          created_at?: string | null
          created_by?: string | null
          decisions?: string | null
          id?: string | null
          ordre_du_jour?: string | null
          participants?: string | null
          titre?: string | null
        }
        Update: {
          at?: string | null
          cabinet_tenant_id?: string | null
          client_tenant_id?: string | null
          created_at?: string | null
          created_by?: string | null
          decisions?: string | null
          id?: string | null
          ordre_du_jour?: string | null
          participants?: string | null
          titre?: string | null
        }
        Relationships: []
      }
      conformite_v: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          id: string | null
          legal_version_id: string | null
          motif_id: string | null
          note: string | null
          pack_version_id: string | null
          piece_id: string | null
          tenant_id: string | null
          verdict: "conforme" | "a_corriger" | "non_conforme" | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string | null
          legal_version_id?: string | null
          motif_id?: string | null
          note?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          tenant_id?: string | null
          verdict?: "conforme" | "a_corriger" | "non_conforme" | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string | null
          legal_version_id?: string | null
          motif_id?: string | null
          note?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          tenant_id?: string | null
          verdict?: "conforme" | "a_corriger" | "non_conforme" | null
        }
        Relationships: []
      }
      echeances_v: {
        Row: {
          created_at: string | null
          due_date: string | null
          entity_id: string | null
          id: string | null
          kind: string | null
          label: string | null
          pack_version_id: string | null
          period: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          due_date?: string | null
          entity_id?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          pack_version_id?: string | null
          period?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          due_date?: string | null
          entity_id?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          pack_version_id?: string | null
          period?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ecriture_lignes_v: {
        Row: {
          account_code: string | null
          created_at: string | null
          credit: number | null
          debit: number | null
          ecriture_id: string | null
          id: string | null
          libelle: string | null
          ordinal: number | null
          tax_code: string | null
          tenant_id: string | null
        }
        Insert: {
          account_code?: string | null
          created_at?: string | null
          credit?: number | null
          debit?: number | null
          ecriture_id?: string | null
          id?: string | null
          libelle?: string | null
          ordinal?: number | null
          tax_code?: string | null
          tenant_id?: string | null
        }
        Update: {
          account_code?: string | null
          created_at?: string | null
          credit?: number | null
          debit?: number | null
          ecriture_id?: string | null
          id?: string | null
          libelle?: string | null
          ordinal?: number | null
          tax_code?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      ecritures_v: {
        Row: {
          booked_at: string | null
          booked_autonome: boolean | null
          booked_by: string | null
          created_at: string | null
          created_by: string | null
          date_ecriture: string | null
          devise: string | null
          entity_id: string | null
          id: string | null
          journal: string | null
          libelle: string | null
          pack_version_id: string | null
          piece_id: string | null
          reversal_reason_id: string | null
          reverses_id: string | null
          review_motif_id: string | null
          review_note: string | null
          review_outcome: "valide" | "retourne" | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          booked_at?: string | null
          booked_autonome?: boolean | null
          booked_by?: string | null
          created_at?: string | null
          created_by?: string | null
          date_ecriture?: string | null
          devise?: string | null
          entity_id?: string | null
          id?: string | null
          journal?: string | null
          libelle?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          reversal_reason_id?: string | null
          reverses_id?: string | null
          review_motif_id?: string | null
          review_note?: string | null
          review_outcome?: "valide" | "retourne" | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          booked_at?: string | null
          booked_autonome?: boolean | null
          booked_by?: string | null
          created_at?: string | null
          created_by?: string | null
          date_ecriture?: string | null
          devise?: string | null
          entity_id?: string | null
          id?: string | null
          journal?: string | null
          libelle?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          reversal_reason_id?: string | null
          reverses_id?: string | null
          review_motif_id?: string | null
          review_note?: string | null
          review_outcome?: "valide" | "retourne" | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      engagements_v: {
        Row: {
          cabinet_org_id: string | null
          created_at: string | null
          created_by: string | null
          ends_on: string | null
          id: string | null
          pme_org_id: string | null
          starts_on: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          cabinet_org_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ends_on?: string | null
          id?: string | null
          pme_org_id?: string | null
          starts_on?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          cabinet_org_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ends_on?: string | null
          id?: string | null
          pme_org_id?: string | null
          starts_on?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      entities_v: {
        Row: {
          code: string | null
          created_at: string | null
          id: string | null
          is_default: boolean | null
          name: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string | null
          is_default?: boolean | null
          name?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string | null
          is_default?: boolean | null
          name?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      event_log_v: {
        Row: {
          action: string | null
          actor: string | null
          at: string | null
          id: string | null
          motif_id: string | null
          object_id: string | null
          object_schema: string | null
          object_table: string | null
          pack_version_id: string | null
          payload: Json | null
          tenant_id: string | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          at?: string | null
          id?: string | null
          motif_id?: string | null
          object_id?: string | null
          object_schema?: string | null
          object_table?: string | null
          pack_version_id?: string | null
          payload?: Json | null
          tenant_id?: string | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          at?: string | null
          id?: string | null
          motif_id?: string | null
          object_id?: string | null
          object_schema?: string | null
          object_table?: string | null
          pack_version_id?: string | null
          payload?: Json | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      extractions_v: {
        Row: {
          contract: string | null
          created_at: string | null
          flags: Json | null
          id: string | null
          payload: Json | null
          piece_id: string | null
          tenant_id: string | null
        }
        Insert: {
          contract?: string | null
          created_at?: string | null
          flags?: Json | null
          id?: string | null
          payload?: Json | null
          piece_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          contract?: string | null
          created_at?: string | null
          flags?: Json | null
          id?: string | null
          payload?: Json | null
          piece_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      immo_assets_v: {
        Row: {
          category_id: string | null
          coefficient: number | null
          created_at: string | null
          devise: string | null
          duree_annees: number | null
          entity_id: string | null
          id: string | null
          label: string | null
          method: "lineaire" | "degressif" | null
          mise_en_service: string | null
          pack_version_id: string | null
          piece_id: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          valeur_brute: number | null
          valeur_residuelle: number | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          category_id?: string | null
          coefficient?: number | null
          created_at?: string | null
          devise?: string | null
          duree_annees?: number | null
          entity_id?: string | null
          id?: string | null
          label?: string | null
          method?: "lineaire" | "degressif" | null
          mise_en_service?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          valeur_brute?: number | null
          valeur_residuelle?: number | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          category_id?: string | null
          coefficient?: number | null
          created_at?: string | null
          devise?: string | null
          duree_annees?: number | null
          entity_id?: string | null
          id?: string | null
          label?: string | null
          method?: "lineaire" | "degressif" | null
          mise_en_service?: string | null
          pack_version_id?: string | null
          piece_id?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          valeur_brute?: number | null
          valeur_residuelle?: number | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      immo_cessions_v: {
        Row: {
          asset_id: string | null
          at: string | null
          created_at: string | null
          ecriture_id: string | null
          id: string | null
          prix: number | null
          resultat: number | null
          tenant_id: string | null
          vnc: number | null
        }
        Insert: {
          asset_id?: string | null
          at?: string | null
          created_at?: string | null
          ecriture_id?: string | null
          id?: string | null
          prix?: number | null
          resultat?: number | null
          tenant_id?: string | null
          vnc?: number | null
        }
        Update: {
          asset_id?: string | null
          at?: string | null
          created_at?: string | null
          ecriture_id?: string | null
          id?: string | null
          prix?: number | null
          resultat?: number | null
          tenant_id?: string | null
          vnc?: number | null
        }
        Relationships: []
      }
      immo_depreciations_v: {
        Row: {
          asset_id: string | null
          at: string | null
          created_at: string | null
          cumul: number | null
          ecriture_id: string | null
          id: string | null
          motif_id: string | null
          mouvement: number | null
          note: string | null
          tenant_id: string | null
          valeur_recouvrable: number | null
          vnc: number | null
        }
        Insert: {
          asset_id?: string | null
          at?: string | null
          created_at?: string | null
          cumul?: number | null
          ecriture_id?: string | null
          id?: string | null
          motif_id?: string | null
          mouvement?: number | null
          note?: string | null
          tenant_id?: string | null
          valeur_recouvrable?: number | null
          vnc?: number | null
        }
        Update: {
          asset_id?: string | null
          at?: string | null
          created_at?: string | null
          cumul?: number | null
          ecriture_id?: string | null
          id?: string | null
          motif_id?: string | null
          mouvement?: number | null
          note?: string | null
          tenant_id?: string | null
          valeur_recouvrable?: number | null
          vnc?: number | null
        }
        Relationships: []
      }
      immo_dotations_v: {
        Row: {
          asset_id: string | null
          created_at: string | null
          cumul: number | null
          dotation: number | null
          ecriture_id: string | null
          exercice: number | null
          id: string | null
          months: number | null
          pack_version_id: string | null
          tenant_id: string | null
          vnc: number | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string | null
          cumul?: number | null
          dotation?: number | null
          ecriture_id?: string | null
          exercice?: number | null
          id?: string | null
          months?: number | null
          pack_version_id?: string | null
          tenant_id?: string | null
          vnc?: number | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string | null
          cumul?: number | null
          dotation?: number | null
          ecriture_id?: string | null
          exercice?: number | null
          id?: string | null
          months?: number | null
          pack_version_id?: string | null
          tenant_id?: string | null
          vnc?: number | null
        }
        Relationships: []
      }
      memberships_v: {
        Row: {
          created_at: string | null
          id: string | null
          role: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          role?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          role?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notifications_v: {
        Row: {
          created_at: string | null
          id: string | null
          kind: string | null
          payload: Json | null
          read_at: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          kind?: string | null
          payload?: Json | null
          read_at?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          kind?: string | null
          payload?: Json | null
          read_at?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      organizations_v: {
        Row: {
          archived_at: string | null
          archived_reason: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          id: string | null
          jurisdiction: string | null
          kind: string | null
          legal_id: string | null
          name: string | null
          updated_at: string | null
          validation_mode: "autonome" | "mandate" | null
        }
        Insert: {
          archived_at?: string | null
          archived_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          jurisdiction?: string | null
          kind?: string | null
          legal_id?: string | null
          name?: string | null
          updated_at?: string | null
          validation_mode?: "autonome" | "mandate" | null
        }
        Update: {
          archived_at?: string | null
          archived_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          jurisdiction?: string | null
          kind?: string | null
          legal_id?: string | null
          name?: string | null
          updated_at?: string | null
          validation_mode?: "autonome" | "mandate" | null
        }
        Relationships: []
      }
      piece_articles_v: {
        Row: {
          citation_field: string | null
          citation_quantity: string | null
          citation_total_ht: string | null
          citation_unit_price_ht: string | null
          citation_unit_price_ttc: string | null
          created_at: string | null
          designation: string | null
          document_date: string | null
          famille_code: string | null
          famille_source: string | null
          id: string | null
          ordinal: number | null
          pack_version_id: string | null
          period: string | null
          piece_id: string | null
          quantity: number | null
          tenant_id: string | null
          total_ht: number | null
          unit_price_ht: number | null
          unit_price_ttc: number | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          citation_field?: string | null
          citation_quantity?: string | null
          citation_total_ht?: string | null
          citation_unit_price_ht?: string | null
          citation_unit_price_ttc?: string | null
          created_at?: string | null
          designation?: string | null
          document_date?: string | null
          famille_code?: string | null
          famille_source?: string | null
          id?: string | null
          ordinal?: number | null
          pack_version_id?: string | null
          period?: string | null
          piece_id?: string | null
          quantity?: number | null
          tenant_id?: string | null
          total_ht?: number | null
          unit_price_ht?: number | null
          unit_price_ttc?: number | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          citation_field?: string | null
          citation_quantity?: string | null
          citation_total_ht?: string | null
          citation_unit_price_ht?: string | null
          citation_unit_price_ttc?: string | null
          created_at?: string | null
          designation?: string | null
          document_date?: string | null
          famille_code?: string | null
          famille_source?: string | null
          id?: string | null
          ordinal?: number | null
          pack_version_id?: string | null
          period?: string | null
          piece_id?: string | null
          quantity?: number | null
          tenant_id?: string | null
          total_ht?: number | null
          unit_price_ht?: number | null
          unit_price_ttc?: number | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      pieces_v: {
        Row: {
          created_at: string | null
          created_by: string | null
          entity_id: string | null
          id: string | null
          idempotency_key: string | null
          page_count: number | null
          sha256: string | null
          source: string | null
          status: string | null
          storage_path: string | null
          tenant_id: string | null
          updated_at: string | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          entity_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          page_count?: number | null
          sha256?: string | null
          source?: string | null
          status?: string | null
          storage_path?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          entity_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          page_count?: number | null
          sha256?: string | null
          source?: string | null
          status?: string | null
          storage_path?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      ref_account_mappings_v: {
        Row: {
          counterparty_account: string | null
          document_kind: string | null
          id: string | null
          main_account: string | null
          pack_version_id: string | null
          tax_code: string | null
          vat_account: string | null
        }
        Insert: {
          counterparty_account?: string | null
          document_kind?: string | null
          id?: string | null
          main_account?: string | null
          pack_version_id?: string | null
          tax_code?: string | null
          vat_account?: string | null
        }
        Update: {
          counterparty_account?: string | null
          document_kind?: string | null
          id?: string | null
          main_account?: string | null
          pack_version_id?: string | null
          tax_code?: string | null
          vat_account?: string | null
        }
        Relationships: []
      }
      ref_accounts_v: {
        Row: {
          account_class: string | null
          account_code: string | null
          id: string | null
          label: string | null
          pack_version_id: string | null
          parent_code: string | null
        }
        Insert: {
          account_class?: string | null
          account_code?: string | null
          id?: string | null
          label?: string | null
          pack_version_id?: string | null
          parent_code?: string | null
        }
        Update: {
          account_class?: string | null
          account_code?: string | null
          id?: string | null
          label?: string | null
          pack_version_id?: string | null
          parent_code?: string | null
        }
        Relationships: []
      }
      ref_anomaly_thresholds_v: {
        Row: {
          code: string | null
          deviation_ratio: number | null
          id: string | null
          min_amount: number | null
          min_periods: number | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          code?: string | null
          deviation_ratio?: number | null
          id?: string | null
          min_amount?: number | null
          min_periods?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          code?: string | null
          deviation_ratio?: number | null
          id?: string | null
          min_amount?: number | null
          min_periods?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_charge_famille_rules_v: {
        Row: {
          famille_code: string | null
          id: string | null
          match_kind: string | null
          pack_version_id: string | null
          pattern: string | null
          priority: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          famille_code?: string | null
          id?: string | null
          match_kind?: string | null
          pack_version_id?: string | null
          pattern?: string | null
          priority?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          famille_code?: string | null
          id?: string | null
          match_kind?: string | null
          pack_version_id?: string | null
          pattern?: string | null
          priority?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_charge_familles_v: {
        Row: {
          code: string | null
          id: string | null
          is_fallback: boolean | null
          label: string | null
          ordinal: number | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          is_fallback?: boolean | null
          label?: string | null
          ordinal?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          is_fallback?: boolean | null
          label?: string | null
          ordinal?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_fiscal_charges_v: {
        Row: {
          account_code: string | null
          code: string | null
          document_kind: string | null
          fixed_amount: number | null
          id: string | null
          label: string | null
          legal_reference: string | null
          pack_version_id: string | null
          taxable: boolean | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          account_code?: string | null
          code?: string | null
          document_kind?: string | null
          fixed_amount?: number | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          taxable?: boolean | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          account_code?: string | null
          code?: string | null
          document_kind?: string | null
          fixed_amount?: number | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          taxable?: boolean | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_immo_categories_v: {
        Row: {
          account_amort: string | null
          account_dotation: string | null
          account_immo: string | null
          code: string | null
          coefficient: number | null
          duree_annees: number | null
          id: string | null
          label: string | null
          legal_reference: string | null
          method: "lineaire" | "degressif" | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          account_amort?: string | null
          account_dotation?: string | null
          account_immo?: string | null
          code?: string | null
          coefficient?: number | null
          duree_annees?: number | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          method?: "lineaire" | "degressif" | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          account_amort?: string | null
          account_dotation?: string | null
          account_immo?: string | null
          code?: string | null
          coefficient?: number | null
          duree_annees?: number | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          method?: "lineaire" | "degressif" | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_labels_v: {
        Row: {
          id: string | null
          key: string | null
          locale: string | null
          ns: string | null
          value: string | null
        }
        Insert: {
          id?: string | null
          key?: string | null
          locale?: string | null
          ns?: string | null
          value?: string | null
        }
        Update: {
          id?: string | null
          key?: string | null
          locale?: string | null
          ns?: string | null
          value?: string | null
        }
        Relationships: []
      }
      ref_mentions_v: {
        Row: {
          code: string | null
          id: string | null
          label: string | null
          legal_reference: string | null
          mandatory: boolean | null
          pack_version_id: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          mandatory?: boolean | null
          pack_version_id?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          mandatory?: boolean | null
          pack_version_id?: string | null
        }
        Relationships: []
      }
      ref_pack_rules_v: {
        Row: {
          cadence: string | null
          day_of_month: number | null
          id: string | null
          jurisdiction: string | null
          kind: string | null
          label: string | null
          legal_reference: string | null
          month_offset: number | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          cadence?: string | null
          day_of_month?: number | null
          id?: string | null
          jurisdiction?: string | null
          kind?: string | null
          label?: string | null
          legal_reference?: string | null
          month_offset?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          cadence?: string | null
          day_of_month?: number | null
          id?: string | null
          jurisdiction?: string | null
          kind?: string | null
          label?: string | null
          legal_reference?: string | null
          month_offset?: number | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_packs_v: {
        Row: {
          effective_from: string | null
          effective_to: string | null
          id: string | null
          jurisdiction: string | null
          ratified: boolean | null
          source: string | null
          validated_at: string | null
          version: string | null
        }
        Insert: {
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          jurisdiction?: string | null
          ratified?: never
          source?: string | null
          validated_at?: string | null
          version?: string | null
        }
        Update: {
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          jurisdiction?: string | null
          ratified?: never
          source?: string | null
          validated_at?: string | null
          version?: string | null
        }
        Relationships: []
      }
      ref_rejet_motifs_v: {
        Row: {
          active: boolean | null
          code: string | null
          id: string | null
          requires_note: boolean | null
          severity: string | null
          sort_order: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean | null
          code?: string | null
          id?: string | null
          requires_note?: boolean | null
          severity?: string | null
          sort_order?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean | null
          code?: string | null
          id?: string | null
          requires_note?: boolean | null
          severity?: string | null
          sort_order?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_socle_params_v: {
        Row: {
          code: string | null
          id: string | null
          legal_reference: string | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
          value_num: number | null
          value_text: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          value_num?: number | null
          value_text?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          value_num?: number | null
          value_text?: string | null
        }
        Relationships: []
      }
      ref_stock_categories_v: {
        Row: {
          account_provision: string | null
          account_provision_dotation: string | null
          account_provision_reprise: string | null
          account_stock: string | null
          account_variation: string | null
          code: string | null
          id: string | null
          label: string | null
          legal_reference: string | null
          pack_version_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          account_provision?: string | null
          account_provision_dotation?: string | null
          account_provision_reprise?: string | null
          account_stock?: string | null
          account_variation?: string | null
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          account_provision?: string | null
          account_provision_dotation?: string | null
          account_provision_reprise?: string | null
          account_stock?: string | null
          account_variation?: string | null
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      ref_tva_rates_v: {
        Row: {
          code: string | null
          id: string | null
          label: string | null
          legal_reference: string | null
          pack_version_id: string | null
          rate: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          rate?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          label?: string | null
          legal_reference?: string | null
          pack_version_id?: string | null
          rate?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      stocks_depreciations_v: {
        Row: {
          at: string | null
          created_at: string | null
          cumul: number | null
          ecriture_id: string | null
          id: string | null
          item_id: string | null
          mouvement: number | null
          note: string | null
          pack_version_id: string | null
          tenant_id: string | null
          valeur_nette: number | null
          valeur_stock: number | null
        }
        Insert: {
          at?: string | null
          created_at?: string | null
          cumul?: number | null
          ecriture_id?: string | null
          id?: string | null
          item_id?: string | null
          mouvement?: number | null
          note?: string | null
          pack_version_id?: string | null
          tenant_id?: string | null
          valeur_nette?: number | null
          valeur_stock?: number | null
        }
        Update: {
          at?: string | null
          created_at?: string | null
          cumul?: number | null
          ecriture_id?: string | null
          id?: string | null
          item_id?: string | null
          mouvement?: number | null
          note?: string | null
          pack_version_id?: string | null
          tenant_id?: string | null
          valeur_nette?: number | null
          valeur_stock?: number | null
        }
        Relationships: []
      }
      stocks_inventaires_v: {
        Row: {
          created_at: string | null
          ecriture_id: string | null
          final: number | null
          id: string | null
          initial: number | null
          item_id: string | null
          pack_version_id: string | null
          period: string | null
          tenant_id: string | null
          variation: number | null
        }
        Insert: {
          created_at?: string | null
          ecriture_id?: string | null
          final?: number | null
          id?: string | null
          initial?: number | null
          item_id?: string | null
          pack_version_id?: string | null
          period?: string | null
          tenant_id?: string | null
          variation?: number | null
        }
        Update: {
          created_at?: string | null
          ecriture_id?: string | null
          final?: number | null
          id?: string | null
          initial?: number | null
          item_id?: string | null
          pack_version_id?: string | null
          period?: string | null
          tenant_id?: string | null
          variation?: number | null
        }
        Relationships: []
      }
      stocks_items_v: {
        Row: {
          account_stock: string | null
          account_variation: string | null
          active: boolean | null
          category_id: string | null
          created_at: string | null
          designation: string | null
          devise: string | null
          entity_id: string | null
          id: string | null
          methode: "cump" | "fifo" | null
          pack_version_id: string | null
          reference: string | null
          tenant_id: string | null
          unite: string | null
          updated_at: string | null
          vis: "personnel" | "partage" | null
        }
        Insert: {
          account_stock?: string | null
          account_variation?: string | null
          active?: boolean | null
          category_id?: string | null
          created_at?: string | null
          designation?: string | null
          devise?: string | null
          entity_id?: string | null
          id?: string | null
          methode?: "cump" | "fifo" | null
          pack_version_id?: string | null
          reference?: string | null
          tenant_id?: string | null
          unite?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Update: {
          account_stock?: string | null
          account_variation?: string | null
          active?: boolean | null
          category_id?: string | null
          created_at?: string | null
          designation?: string | null
          devise?: string | null
          entity_id?: string | null
          id?: string | null
          methode?: "cump" | "fifo" | null
          pack_version_id?: string | null
          reference?: string | null
          tenant_id?: string | null
          unite?: string | null
          updated_at?: string | null
          vis?: "personnel" | "partage" | null
        }
        Relationships: []
      }
      stocks_mouvements_v: {
        Row: {
          at: string | null
          cout_unitaire: number | null
          created_at: string | null
          ecriture_id: string | null
          id: string | null
          item_id: string | null
          piece_id: string | null
          quantite: number | null
          reference: string | null
          sens: "entree" | "sortie" | null
          tenant_id: string | null
        }
        Insert: {
          at?: string | null
          cout_unitaire?: number | null
          created_at?: string | null
          ecriture_id?: string | null
          id?: string | null
          item_id?: string | null
          piece_id?: string | null
          quantite?: number | null
          reference?: string | null
          sens?: "entree" | "sortie" | null
          tenant_id?: string | null
        }
        Update: {
          at?: string | null
          cout_unitaire?: number | null
          created_at?: string | null
          ecriture_id?: string | null
          id?: string | null
          item_id?: string | null
          piece_id?: string | null
          quantite?: number | null
          reference?: string | null
          sens?: "entree" | "sortie" | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      token_plan_v: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string | null
          ordinal: number | null
          page: number | null
          piece_id: string | null
          tenant_id: string | null
          text: string | null
          x0: number | null
          x1: number | null
          y0: number | null
          y1: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          ordinal?: number | null
          page?: number | null
          piece_id?: string | null
          tenant_id?: string | null
          text?: string | null
          x0?: number | null
          x1?: number | null
          y0?: number | null
          y1?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          ordinal?: number | null
          page?: number | null
          piece_id?: string | null
          tenant_id?: string | null
          text?: string | null
          x0?: number | null
          x1?: number | null
          y0?: number | null
          y1?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      agents_run_log: {
        Args: {
          p_agent: string
          p_error?: string
          p_latency_ms: number
          p_model: string
          p_piece?: string
          p_role: string
          p_status: string
          p_tenant: string
          p_tokens_in?: number
          p_tokens_out?: number
        }
        Returns: string
      }
      banque_book_lignes: {
        Args: {
          p_from: string
          p_prefix: string
          p_tenant: string
          p_to: string
        }
        Returns: {
          date_ecriture: string
          ecriture_id: string
          journal: string
          lettree: boolean
          libelle: string
          montant: number
          piece_id: string
          reference: string
        }[]
      }
      banque_delettrer: {
        Args: { p_ligne: string; p_motif: string; p_note?: string }
        Returns: Json
      }
      banque_lettrer: {
        Args: {
          p_ecart_jours: number
          p_ecart_montant: number
          p_ecriture: string
          p_ligne: string
          p_pack_version: string
          p_reference_exacte: boolean
          p_score: number
        }
        Returns: Json
      }
      capture_articles_persist: {
        Args: {
          p_account: string
          p_articles: Json
          p_document_date: string
          p_pack: string
          p_piece: string
        }
        Returns: Json
      }
      capture_piece_register: {
        Args: {
          p_entity?: string
          p_idempotency_key: string
          p_page_count?: number
          p_sha256?: string
          p_source: string
          p_storage_path: string
          p_tenant: string
          p_vis?: "personnel" | "partage"
        }
        Returns: string
      }
      capture_piece_set_vis: {
        Args: { p_piece: string; p_vis: "personnel" | "partage" }
        Returns: Json
      }
      capture_read_persist: {
        Args: {
          p_citations: Json
          p_contract: string
          p_extract: Json
          p_flags?: Json
          p_piece: string
          p_tokens: Json
        }
        Returns: Json
      }
      charge_famille_resolve: {
        Args: {
          p_account: string
          p_at?: string
          p_designation: string
          p_pack: string
        }
        Returns: {
          famille_code: string
          famille_source: string
        }[]
      }
      charge_question_answer: {
        Args: {
          p_answer: string
          p_baseline: number
          p_famille: string
          p_observed: number
          p_pack: string
          p_period: string
          p_ratio: number
          p_tenant: string
          p_threshold: string
        }
        Returns: string
      }
      collab_assign: {
        Args: {
          p_briefing?: string
          p_cabinet: string
          p_client: string
          p_user: string
        }
        Returns: string
      }
      create_organization: {
        Args: {
          p_currency?: string
          p_jurisdiction?: string
          p_kind: string
          p_legal_id?: string
          p_name: string
          p_validation_mode?: "autonome" | "mandate"
        }
        Returns: string
      }
      immo_depreciation_constater: {
        Args: {
          p_asset: string
          p_at: string
          p_cumul: number
          p_journal?: string
          p_mouvement: number
          p_note?: string
          p_pack_version: string
          p_valeur_recouvrable: number
          p_vnc: number
        }
        Returns: Json
      }
      immo_dotation_constater: {
        Args: {
          p_asset: string
          p_cumul: number
          p_date?: string
          p_dotation: number
          p_exercice: number
          p_journal?: string
          p_months: number
          p_pack_version: string
          p_vnc: number
        }
        Returns: Json
      }
      set_engagement_status: {
        Args: { p_engagement: string; p_status: string }
        Returns: undefined
      }
      socle_ecriture_book: { Args: { p_ecriture: string }; Returns: undefined }
      socle_ecriture_propose: {
        Args: {
          p_date: string
          p_devise?: string
          p_journal: string
          p_libelle: string
          p_lignes: Json
          p_pack_version: string
          p_piece: string
        }
        Returns: string
      }
      socle_ecriture_review: {
        Args: {
          p_ecriture: string
          p_motif?: string
          p_note?: string
          p_outcome: "valide" | "retourne"
        }
        Returns: string
      }
      socle_periode_lignes: {
        Args: { p_from: string; p_tenant: string; p_to: string }
        Returns: {
          account_code: string
          credit: number
          date_ecriture: string
          debit: number
          ecriture_id: string
          journal: string
          libelle: string
          tax_code: string
        }[]
      }
      stocks_depreciation_constater: {
        Args: {
          p_at: string
          p_cumul: number
          p_item: string
          p_journal?: string
          p_mouvement: number
          p_note?: string
          p_pack_version: string
          p_valeur_nette: number
          p_valeur_stock: number
        }
        Returns: Json
      }
      stocks_inventaire_constater: {
        Args: {
          p_date: string
          p_final: number
          p_initial: number
          p_item: string
          p_journal?: string
          p_pack_version: string
          p_period: string
          p_variation: number
        }
        Returns: Json
      }
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

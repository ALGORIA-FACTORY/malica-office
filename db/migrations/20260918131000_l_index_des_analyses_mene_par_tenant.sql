-- Toute table sous RLS de tenant porte un index qui mène par tenant_id : la
-- politique filtre d'abord par tenant, et sans cet index chaque lecture
-- parcourt la table entière (schema.test.ts, « chaque table sous RLS de tenant
-- a un index menant par tenant_id »). capture.analyses (20260918130000) n'en
-- avait qu'un par pièce.
create index if not exists analyses_tenant_idx
  on capture.analyses (tenant_id, piece_id, created_at desc);

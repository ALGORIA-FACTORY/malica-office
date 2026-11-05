-- ======================================================================
--  Une sortie ne dépasse pas le stock (staging, 5 novembre 2026).
--
--  La porte `stocks_mouvement_inscrire` acceptait une sortie de 5 unités
--  d'un article à stock nul. Le moteur du Socle, lui, la refuse (« Sortie
--  supérieure au stock », `engines/stock/valorisation.ts`) : une fois
--  inscrite, la sortie rendait l'article invalorisable, et le mouvement ne
--  s'efface pas (R7). La base inscrivait ce que le moteur ne sait pas lire.
--
--  La porte tient désormais la même règle que le moteur, dans le même ordre :
--  la date, les entrées du jour avant ses sorties, puis l'ordre
--  d'inscription. Le solde ne descend sous zéro à aucun moment, y compris
--  pour une sortie antidatée qui découvrirait une sortie postérieure. Une
--  inscription à la fois par article : deux sorties simultanées liraient le
--  même solde.
--
--  L'ordre de restitution (`stocks.mouvements` côté API) suit ce même ordre :
--  `order by at` seul laissait l'ordre d'une journée au hasard, et le moteur
--  le reprend tel quel.
-- ======================================================================

begin;

create or replace function public.stocks_mouvement_inscrire(
  p_tenant uuid, p_item uuid, p_sens app.stock_sens_t, p_at date, p_quantite numeric,
  p_cout_unitaire numeric, p_reference text, p_piece uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  -- L'article est celui du dossier, et l'appelant le voit.
  if not exists (select 1 from public.stocks_items_v i where i.id = p_item and i.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.article' using errcode = '42501';
  end if;
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stocks.item:' || p_item::text, 0));

  insert into stocks.mouvements (tenant_id, item_id, sens, at, quantite, cout_unitaire,
                                 reference, piece_id, created_by)
  values (p_tenant, p_item, p_sens, p_at, p_quantite, p_cout_unitaire,
          nullif(btrim(p_reference), ''), p_piece, auth.uid())
  returning id into v_id;

  if p_sens = 'sortie'::app.stock_sens_t and exists (
       select 1
         from (select sum(case when m.sens = 'entree'::app.stock_sens_t then m.quantite
                               else -m.quantite end)
                        over (order by m.at, (m.sens = 'entree'::app.stock_sens_t) desc,
                                       m.created_at, m.id) as solde
                 from stocks.mouvements m
                where m.tenant_id = p_tenant and m.item_id = p_item) s
        where s.solde < 0) then
    raise exception 'refus.stocks.stock_insuffisant' using errcode = '22023';
  end if;

  return v_id;
end
$function$;

commit;

-- La tour règle ce que Malica fait d'une réponse à relire et d'un corpus muet.
--
-- `20261212100000` et `20261212100200` ont livré les deux règles par migration
-- (`annoncer`, `marquer`). R10 : un défaut se change sans migration. La tour
-- reçoit sa carte — elle lit la décision en vigueur et en inscrit une nouvelle,
-- datée et motivée ; la précédente reste au registre.

begin;

create or replace function plateforme.assistant_relecture_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
                   'mode', l.mode,
                   'sans_texte', coalesce(l.sans_texte, 'retirer'),
                   'motif', l.motif,
                   'decide_le', l.decide_le)
            from plateforme.assistant_relectures l
           order by l.decide_le desc, l.id desc limit 1);
end
$$;

revoke all on function plateforme.assistant_relecture_etat() from public, anon;
grant execute on function plateforme.assistant_relecture_etat() to authenticated;

create or replace function plateforme.assistant_relecture_regler(
  p_mode text, p_sans_texte text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('annoncer', 'retenir')
     or p_sans_texte is null or p_sans_texte not in ('marquer', 'retirer')
     or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.assistant.saisie' using errcode = 'check_violation';
  end if;
  -- La décision nouvelle passe toujours devant la précédente, même si celle-ci
  -- porte une date livrée postérieure à l'horloge du serveur.
  insert into plateforme.assistant_relectures (mode, sans_texte, motif, decide_par, decide_le)
  select p_mode, p_sans_texte, btrim(p_motif), auth.uid(),
         greatest(now(), coalesce(max(l.decide_le), now()) + interval '1 millisecond')
    from plateforme.assistant_relectures l;
  return plateforme.assistant_relecture_etat();
end
$$;

revoke all on function plateforme.assistant_relecture_regler(text, text, text) from public, anon;
grant execute on function plateforme.assistant_relecture_regler(text, text, text) to authenticated;

commit;

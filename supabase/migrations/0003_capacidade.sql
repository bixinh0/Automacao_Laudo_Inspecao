-- Capacidade para ~600 laudos/mês no plano gratuito do Supabase (1 GB de arquivos).
-- Rode no SQL Editor do Supabase. Pode ser rodada de novo sem erro.
--
-- A partir desta versão só o PDF é guardado (as fotos ficam embutidas nele) e,
-- quando o espaço passa do limite, a limpeza automática apaga os PDFs mais
-- antigos (que já devem estar arquivados no drive pelo ZIP do dia).

alter table laudo add column if not exists pdf_removido_em timestamptz;  -- nulo = PDF disponível

comment on column imagem.caminho_arquivo is
  'Arquivo onde a imagem está: o PDF do laudo, onde ela fica embutida (antes da migration 0003, a foto processada).';

-- Espaço ocupado no bucket "laudos" e data do laudo mais antigo com PDF disponível.
create or replace function uso_armazenamento_laudos()
returns table (bytes_total bigint, mais_antigo timestamptz)
language sql stable security definer
set search_path = public, storage
as $$
  select
    (select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
       from storage.objects o where o.bucket_id = 'laudos'),
    (select min(l.criado_em) from public.laudo l
       where l.caminho_pdf is not null and l.pdf_removido_em is null);
$$;

-- PDFs que precisam sair para o bucket voltar a caber em limite_bytes, do mais antigo ao mais novo.
-- Conta também o que não é PDF (fotos de envios em andamento ou abandonados).
create or replace function laudos_para_liberar_espaco(limite_bytes bigint)
returns table (id uuid, caminho_pdf text)
language sql stable security definer
set search_path = public, storage
as $$
  with pdfs as (
    select l.id, l.caminho_pdf, l.criado_em, coalesce((o.metadata->>'size')::bigint, 0) as tamanho
    from public.laudo l
    join storage.objects o on o.bucket_id = 'laudos' and o.name = l.caminho_pdf
    where l.pdf_removido_em is null
  ),
  outros as (
    select coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
    from storage.objects o
    where o.bucket_id = 'laudos' and not exists (select 1 from pdfs p where p.caminho_pdf = o.name)
  ),
  acumulado as (
    -- Do mais novo para o mais antigo: os mais novos têm prioridade para ficar.
    select p.id, p.caminho_pdf, p.criado_em,
           (select bytes from outros) + sum(p.tamanho) over (order by p.criado_em desc, p.id rows unbounded preceding) as total
    from pdfs p
  )
  select a.id, a.caminho_pdf from acumulado a where a.total > limite_bytes order by a.criado_em;
$$;

revoke all on function uso_armazenamento_laudos() from public, anon, authenticated;
revoke all on function laudos_para_liberar_espaco(bigint) from public, anon, authenticated;
grant execute on function uso_armazenamento_laudos() to service_role;
grant execute on function laudos_para_liberar_espaco(bigint) to service_role;

-- Envio imediato das fotos: o laudo nasce como RASCUNHO assim que a OP é informada
-- e cada foto é vinculada a ele logo que chega ao servidor. Ao gerar o PDF, vira EMITIDO.
-- Rode no SQL Editor do Supabase. Pode ser rodada de novo sem erro.

do $$ begin
  create type status_laudo as enum ('RASCUNHO', 'EMITIDO');
exception when duplicate_object then null;
end $$;

alter table laudo add column if not exists status status_laudo not null default 'RASCUNHO';
update laudo set status = 'EMITIDO' where caminho_pdf is not null and status <> 'EMITIDO';
create index if not exists laudo_rascunho_idx on laudo (criado_em) where status = 'RASCUNHO';

-- A linha da foto é criada quando o envio começa; hash e dimensões chegam quando o servidor a processa.
alter table imagem
  alter column hash_sha256 drop not null,
  alter column largura drop not null,
  alter column altura drop not null;
alter table imagem add column if not exists recebida_em timestamptz;  -- nulo = envio em andamento
update imagem set recebida_em = l.criado_em
  from laudo l
  where l.id = imagem.laudo_id and imagem.recebida_em is null and imagem.hash_sha256 is not null;

do $$ begin
  alter table imagem add constraint imagem_recebida_completa
    check (recebida_em is null or (hash_sha256 is not null and largura is not null and altura is not null));
exception when duplicate_object then null;
end $$;

comment on column imagem.caminho_arquivo is
  'Rascunho: a foto processada ({laudo}/fotos/{imagem}.jpg). Emitido: o PDF do laudo, onde ela fica embutida.';

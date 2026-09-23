-- Laudo de Inspeção de Produção — estrutura inicial.
-- Rode uma única vez no SQL Editor do Supabase (painel web, sem instalar nada).

create type tipo_imagem as enum ('FORMULARIO', 'PECA');

create table laudo (
  id           uuid primary key default gen_random_uuid(),
  numero_op    text not null check (numero_op ~ '^[0-9]{4,8}$'),
  observacoes  text,
  criado_em    timestamptz not null default now(),
  caminho_pdf  text  -- preenchido após a geração do PDF; nulo = envio não concluído
);

create index laudo_numero_op_idx on laudo (numero_op);
create index laudo_criado_em_idx on laudo (criado_em desc);

-- Só metadados: o arquivo fica no Storage (bucket "laudos").
create table imagem (
  id               uuid primary key default gen_random_uuid(),
  laudo_id         uuid not null references laudo (id) on delete cascade,
  tipo             tipo_imagem not null,
  caminho_arquivo  text not null,
  hash_sha256      char(64) not null,  -- SHA-256 do arquivo gravado no Storage
  largura          integer not null check (largura > 0),
  altura           integer not null check (altura > 0),
  ordem            integer not null check (ordem > 0),
  unique (laudo_id, tipo, ordem)
);

create index imagem_laudo_id_idx on imagem (laudo_id);

-- Sem políticas: só o servidor (chave secreta / service_role) acessa as tabelas.
alter table laudo enable row level security;
alter table imagem enable row level security;

-- Bucket privado para fotos e PDFs (limite de 50 MB por arquivo, o máximo do plano gratuito).
insert into storage.buckets (id, name, public, file_size_limit)
values ('laudos', 'laudos', false, 52428800)
on conflict (id) do nothing;

-- Evolução prevista (NÃO implementar agora):
--   Fase 2: tabela "medicao" (laudo_id, item, valor, unidade...) com os dados digitados;
--           a foto do formulário passa a ser opcional.
--   Fase 3: coluna laudo.status (RASCUNHO | EM_REVISAO | EMITIDO) para a revisão humana
--           da transcrição por IA antes da emissão.
--   Fase 4: tabela "tolerancia" para validar as medidas.
-- Nada disso exige mudar as tabelas acima: são acréscimos.

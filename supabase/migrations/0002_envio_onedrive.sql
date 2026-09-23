-- Envio automático dos laudos para o OneDrive/SharePoint (opcional).
-- Rode no SQL Editor do Supabase antes de configurar o OneDrive.

alter table laudo
  add column onedrive_enviado_em timestamptz,  -- nulo = ainda não enviado
  add column onedrive_url        text,         -- endereço do PDF no SharePoint
  add column onedrive_erro       text;         -- motivo da última falha de envio

create index laudo_onedrive_pendente_idx on laudo (criado_em) where onedrive_enviado_em is null;

-- Credenciais de integrações (o refresh token da Microsoft fica cifrado pelo servidor).
create table integracao (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now()
);

alter table integracao enable row level security;

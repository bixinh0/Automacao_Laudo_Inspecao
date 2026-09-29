-- Autenticação e gestão de usuários (Supabase Auth + tabela profiles).
-- Rode uma única vez no SQL Editor do Supabase, depois das migrations 0001 a 0003.
--
-- As regras de quem pode fazer o quê são aplicadas no servidor E aqui no banco
-- (RLS + gatilhos), para valerem mesmo que a aplicação tenha uma falha.
-- Nenhum e-mail é enviado: o acesso é liberado por aprovação manual.

create type departamento as enum (
  'PRODUCAO', 'SUPRIMENTOS', 'ADMINISTRATIVO', 'COMERCIAL',
  'RECURSOS_HUMANOS', 'ENGENHARIA', 'QUALIDADE', 'SUPORTE_TECNICO'
);
create type papel_usuario  as enum ('OWNER', 'ADMIN', 'USUARIO');
create type situacao_conta as enum ('PENDENTE', 'APROVADO', 'RECUSADO', 'SUSPENSO');

create table profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  nome                text not null check (length(trim(nome)) >= 3),
  -- Domínio fixo aqui como segunda barreira; a aplicação usa ALLOWED_EMAIL_DOMAIN.
  -- Se o domínio mudar, altere os dois.
  email               text not null unique
                      check (email = lower(email) and email ~ '^[^@[:space:]]+@vanderhulst\.com\.br$'),
  departamento        departamento   not null,
  papel               papel_usuario  not null default 'USUARIO',
  situacao            situacao_conta not null default 'PENDENTE',
  motivo_recusa       text,
  senha_provisoria    boolean not null default false,
  provisoria_expira   timestamptz,   -- nulo com senha_provisoria = sem prazo (senha inicial do OWNER)
  -- Reservado para a confirmação de e-mail por código, quando houver envio de e-mail.
  email_confirmado_em timestamptz,
  decidido_por        uuid references profiles (id) on delete set null,
  decidido_em         timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- No máximo um OWNER.
create unique index apenas_um_owner on profiles ((papel)) where papel = 'OWNER';
create index profiles_situacao_idx on profiles (situacao);

create table log_auditoria (
  id         uuid primary key default gen_random_uuid(),
  ator_id    uuid references profiles (id) on delete set null,
  acao       text not null,  -- APROVAR, RECUSAR, SUSPENDER, PROMOVER, REBAIXAR, REMOVER, EDITAR, REDEFINIR_SENHA…
  alvo_id    uuid,
  -- Nome e e-mail de ator e alvo guardados junto: o registro continua legível se alguém for removido.
  detalhes   jsonb,
  criado_em  timestamptz not null default now()
);
create index log_auditoria_criado_em_idx on log_auditoria (criado_em desc);

-- Tentativas de login, para o limite de 5 falhas em 15 minutos por e-mail e por IP.
create table tentativas_login (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text not null,
  sucesso    boolean not null,
  criado_em  timestamptz not null default now()
);
create index tentativas_login_email_idx on tentativas_login (email, criado_em desc);
create index tentativas_login_ip_idx on tentativas_login (ip, criado_em desc);

-- Autoria dos laudos (os emitidos antes desta migration ficam sem autor).
alter table laudo
  add column criado_por      uuid references profiles (id) on delete set null,
  add column criado_por_nome text;

-- Guarda marcações internas (ex.: redefinição de emergência da senha do OWNER). Já existe se a 0002 rodou.
create table if not exists integracao (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now()
);
alter table integracao enable row level security;

-- ---------------------------------------------------------------------------
-- Funções auxiliares (security definer: leem profiles sem cair na própria RLS)
-- ---------------------------------------------------------------------------

create or replace function perfil_de(uid uuid)
returns profiles language sql stable security definer set search_path = public as $$
  select * from profiles where id = uid;
$$;

-- Quem está logado é OWNER ou ADMIN com acesso aprovado?
create or replace function sou_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and papel in ('OWNER', 'ADMIN') and situacao = 'APROVADO'
  );
$$;

-- ---------------------------------------------------------------------------
-- Regras que valem para qualquer caminho de escrita (inclusive a chave secreta)
-- ---------------------------------------------------------------------------

create or replace function proteger_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ator profiles;
  eu uuid := auth.uid();  -- nulo quando quem escreve é o servidor (chave secreta) ou o SQL Editor
begin
  if tg_op = 'DELETE' then
    if old.papel = 'OWNER' then
      raise exception 'O registro do OWNER não pode ser removido.' using errcode = '42501';
    end if;
    if eu is not null then
      ator := perfil_de(eu);
      if ator.id is null or ator.situacao <> 'APROVADO' or ator.papel not in ('OWNER', 'ADMIN') then
        raise exception 'Sem permissão para remover usuários.' using errcode = '42501';
      end if;
      if old.id = eu then
        raise exception 'Você não pode remover o próprio cadastro.' using errcode = '42501';
      end if;
      if ator.papel = 'ADMIN' and old.papel = 'ADMIN' then
        raise exception 'Só o OWNER pode remover um ADMIN.' using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  -- INSERT e UPDATE: o OWNER é sempre APROVADO; ninguém vira OWNER depois de criado.
  if new.papel = 'OWNER' and new.situacao <> 'APROVADO' then
    raise exception 'O OWNER não pode ser suspenso, recusado nem ficar pendente.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  new.atualizado_em := now();
  if new.id <> old.id or new.email <> old.email or new.criado_em <> old.criado_em then
    raise exception 'Identificador, e-mail e data de cadastro não podem ser alterados.' using errcode = '42501';
  end if;
  if old.papel = 'OWNER' and new.papel <> 'OWNER' then
    raise exception 'O OWNER não pode ser rebaixado.' using errcode = '42501';
  end if;
  if new.papel = 'OWNER' and old.papel <> 'OWNER' then
    raise exception 'Não é possível promover alguém a OWNER.' using errcode = '42501';
  end if;

  if eu is null then
    return new;  -- servidor: as regras de ator foram checadas na aplicação
  end if;

  -- Remoção de quem tinha aprovado este cadastro: o banco limpa decidido_por sozinho.
  if new.decidido_por is null and old.decidido_por is not null
     and (to_jsonb(new) - 'decidido_por' - 'atualizado_em') = (to_jsonb(old) - 'decidido_por' - 'atualizado_em') then
    return new;
  end if;

  ator := perfil_de(eu);
  if ator.id is null then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  if old.id = eu then
    -- O próprio usuário: só nome e departamento.
    if new.papel <> old.papel or new.situacao <> old.situacao then
      raise exception 'Você não pode alterar o próprio papel nem a própria situação.' using errcode = '42501';
    end if;
    if (new.motivo_recusa, new.senha_provisoria, new.provisoria_expira, new.email_confirmado_em, new.decidido_por, new.decidido_em)
       is distinct from
       (old.motivo_recusa, old.senha_provisoria, old.provisoria_expira, old.email_confirmado_em, old.decidido_por, old.decidido_em) then
      raise exception 'Você só pode alterar o próprio nome e departamento.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Alterando outra pessoa.
  if ator.situacao <> 'APROVADO' or ator.papel not in ('OWNER', 'ADMIN') then
    raise exception 'Sem permissão para alterar outros usuários.' using errcode = '42501';
  end if;
  if old.papel = 'OWNER' then
    raise exception 'Apenas o próprio OWNER pode alterar o cadastro do OWNER.' using errcode = '42501';
  end if;
  if ator.papel = 'ADMIN' and old.papel = 'ADMIN' then
    raise exception 'Só o OWNER pode alterar um ADMIN.' using errcode = '42501';
  end if;
  if new.papel <> old.papel and ator.papel <> 'OWNER' then
    raise exception 'Só o OWNER pode promover ou rebaixar usuários.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger proteger_profiles
  before insert or update or delete on profiles
  for each row execute function proteger_profiles();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table log_auditoria enable row level security;
alter table tentativas_login enable row level security;

-- Leitura: o próprio perfil; OWNER e ADMIN leem todos.
create policy profiles_ler on profiles for select to authenticated
  using (id = auth.uid() or sou_gestor());

-- Alteração: o próprio perfil, ou OWNER/ADMIN em perfis que não sejam do OWNER.
-- (As regras por coluna — papel, situação, alvo ADMIN — ficam no gatilho acima.)
create policy profiles_alterar on profiles for update to authenticated
  using (id = auth.uid() or (sou_gestor() and papel <> 'OWNER'))
  with check (id = auth.uid() or (sou_gestor() and papel <> 'OWNER'));

-- Remoção: OWNER/ADMIN, nunca o OWNER nem a si mesmo.
create policy profiles_remover on profiles for delete to authenticated
  using (sou_gestor() and papel <> 'OWNER' and id <> auth.uid());

-- Sem política de INSERT: contas são criadas só pelo servidor, que valida o domínio.

-- Log: OWNER e ADMIN leem; só o servidor escreve.
create policy log_ler on log_auditoria for select to authenticated using (sou_gestor());

-- tentativas_login: sem políticas (só o servidor acessa).

grant select, update, delete on profiles to authenticated;
grant select on log_auditoria to authenticated;
-- perfil_de só é usada dentro do gatilho; liberada, deixaria qualquer um ler perfis alheios.
revoke all on function perfil_de(uuid) from public, anon, authenticated;
revoke all on function sou_gestor() from public, anon;
grant execute on function sou_gestor() to authenticated, service_role;

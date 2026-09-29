-- Testes das regras de permissão no banco (RLS + gatilhos), simulando cada papel.
-- Roda num Postgres com as migrations aplicadas e o ambiente simulado do Supabase
-- (ver supabase/testes/supabase_simulado.sql). Falha com erro se alguma regra quebrar.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'luan.godoi@vanderhulst.com.br'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@vanderhulst.com.br'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@vanderhulst.com.br'),
  ('00000000-0000-0000-0000-0000000000b1', 'usuario1@vanderhulst.com.br'),
  ('00000000-0000-0000-0000-0000000000b2', 'usuario2@vanderhulst.com.br'),
  ('00000000-0000-0000-0000-0000000000c1', 'pendente@vanderhulst.com.br');
insert into profiles (id, nome, email, departamento, papel, situacao) values
  ('00000000-0000-0000-0000-00000000000a', 'Luan Godoi', 'luan.godoi@vanderhulst.com.br', 'QUALIDADE', 'OWNER', 'APROVADO'),
  ('00000000-0000-0000-0000-0000000000a1', 'Admin Um', 'admin1@vanderhulst.com.br', 'PRODUCAO', 'ADMIN', 'APROVADO'),
  ('00000000-0000-0000-0000-0000000000a2', 'Admin Dois', 'admin2@vanderhulst.com.br', 'PRODUCAO', 'ADMIN', 'APROVADO'),
  ('00000000-0000-0000-0000-0000000000b1', 'Usuario Um', 'usuario1@vanderhulst.com.br', 'ENGENHARIA', 'USUARIO', 'APROVADO'),
  ('00000000-0000-0000-0000-0000000000b2', 'Usuario Dois', 'usuario2@vanderhulst.com.br', 'ENGENHARIA', 'USUARIO', 'APROVADO'),
  ('00000000-0000-0000-0000-0000000000c1', 'Pendente', 'pendente@vanderhulst.com.br', 'COMERCIAL', 'USUARIO', 'PENDENTE');

-- Executa `comando` como usuário autenticado `uid` e devolve 'ok:<linhas afetadas>' ou 'erro'.
create function pg_temp.como(uid uuid, comando text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute comando;
    get diagnostics n = row_count;
    execute 'reset role';
    return 'ok:' || n;
  exception when others then
    execute 'reset role';
    return 'erro';
  end;
end $$;

create function pg_temp.espera(descricao text, obtido text, esperado text) returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', descricao, obtido, esperado;
  end if;
  raise notice 'ok  %', descricao;
end $$;

-- Executa como o servidor (chave secreta: sem usuário, sem RLS).
create function pg_temp.como_servidor(comando text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  begin
    execute comando;
    get diagnostics n = row_count;
    execute 'reset role';
    return 'ok:' || n;
  exception when others then
    execute 'reset role';
    return 'erro';
  end;
end $$;

-- Atalhos de ids
\set O  '''00000000-0000-0000-0000-00000000000a'''
\set A1 '''00000000-0000-0000-0000-0000000000a1'''
\set A2 '''00000000-0000-0000-0000-0000000000a2'''
\set U1 '''00000000-0000-0000-0000-0000000000b1'''
\set U2 '''00000000-0000-0000-0000-0000000000b2'''
\set P  '''00000000-0000-0000-0000-0000000000c1'''

-- ===== ADMIN contra o OWNER: nada passa =====
select pg_temp.espera('ADMIN não suspende o OWNER',
  (select pg_temp.como(:A1, format('update profiles set situacao=''SUSPENSO'' where id=%L', :O)))
  in ('ok:0','erro')::text, 'true');
select pg_temp.espera('ADMIN não rebaixa o OWNER',
  (select pg_temp.como(:A1, format('update profiles set papel=''USUARIO'' where id=%L', :O))) in ('ok:0','erro')::text, 'true');
select pg_temp.espera('ADMIN não edita o nome do OWNER',
  (select pg_temp.como(:A1, format('update profiles set nome=''Outro Nome'' where id=%L', :O))) in ('ok:0','erro')::text, 'true');
select pg_temp.espera('ADMIN não marca senha provisória no OWNER',
  (select pg_temp.como(:A1, format('update profiles set senha_provisoria=true where id=%L', :O))) in ('ok:0','erro')::text, 'true');
select pg_temp.espera('ADMIN não remove o OWNER',
  (select pg_temp.como(:A1, format('delete from profiles where id=%L', :O))) in ('ok:0','erro')::text, 'true');

-- ===== OWNER contra si mesmo =====
select pg_temp.espera('OWNER não se rebaixa',
  pg_temp.como(:O, format('update profiles set papel=''ADMIN'' where id=%L', :O)), 'erro');
select pg_temp.espera('OWNER não se suspende',
  pg_temp.como(:O, format('update profiles set situacao=''SUSPENSO'' where id=%L', :O)), 'erro');
select pg_temp.espera('OWNER não se remove',
  (select pg_temp.como(:O, format('delete from profiles where id=%L', :O))) in ('ok:0','erro')::text, 'true');
select pg_temp.espera('OWNER edita o próprio nome',
  pg_temp.como(:O, format('update profiles set nome=''Luan G. Godoi'' where id=%L', :O)), 'ok:1');

-- ===== Promoção e rebaixamento =====
select pg_temp.espera('ADMIN não promove usuário a ADMIN',
  pg_temp.como(:A1, format('update profiles set papel=''ADMIN'' where id=%L', :U1)), 'erro');
select pg_temp.espera('Ninguém promove a OWNER (nem o OWNER)',
  pg_temp.como(:O, format('update profiles set papel=''OWNER'' where id=%L', :U1)), 'erro');
select pg_temp.espera('OWNER promove usuário a ADMIN',
  pg_temp.como(:O, format('update profiles set papel=''ADMIN'' where id=%L', :U2)), 'ok:1');
select pg_temp.espera('OWNER rebaixa ADMIN para USUARIO',
  pg_temp.como(:O, format('update profiles set papel=''USUARIO'' where id=%L', :U2)), 'ok:1');

-- ===== ADMIN contra outro ADMIN =====
select pg_temp.espera('ADMIN não suspende outro ADMIN',
  pg_temp.como(:A1, format('update profiles set situacao=''SUSPENSO'' where id=%L', :A2)), 'erro');
select pg_temp.espera('ADMIN não rebaixa outro ADMIN',
  pg_temp.como(:A1, format('update profiles set papel=''USUARIO'' where id=%L', :A2)), 'erro');
select pg_temp.espera('ADMIN não edita outro ADMIN',
  pg_temp.como(:A1, format('update profiles set nome=''Admin Mudado'' where id=%L', :A2)), 'erro');
select pg_temp.espera('ADMIN não marca senha provisória em outro ADMIN',
  pg_temp.como(:A1, format('update profiles set senha_provisoria=true where id=%L', :A2)), 'erro');
select pg_temp.espera('ADMIN não remove outro ADMIN',
  pg_temp.como(:A1, format('delete from profiles where id=%L', :A2)), 'erro');

-- ===== Próprio papel / situação =====
select pg_temp.espera('ADMIN não muda a própria situação',
  pg_temp.como(:A1, format('update profiles set situacao=''SUSPENSO'' where id=%L', :A1)), 'erro');
select pg_temp.espera('Usuário não se promove',
  pg_temp.como(:U1, format('update profiles set papel=''ADMIN'' where id=%L', :U1)), 'erro');
select pg_temp.espera('Usuário não tira a própria senha provisória',
  (select pg_temp.como_servidor(format('update profiles set senha_provisoria=true where id=%L', :U1)) = 'ok:1'
     and pg_temp.como(:U1, format('update profiles set senha_provisoria=false where id=%L', :U1)) = 'erro')::text, 'true');
select pg_temp.espera('Usuário edita o próprio departamento',
  pg_temp.como(:U1, format('update profiles set departamento=''QUALIDADE'' where id=%L', :U1)), 'ok:1');
select pg_temp.espera('Pendente não se aprova',
  pg_temp.como(:P, format('update profiles set situacao=''APROVADO'' where id=%L', :P)), 'erro');

-- ===== Usuário comum contra outros =====
select pg_temp.espera('Usuário não lê perfis alheios',
  pg_temp.como(:U1, 'select * from profiles'), 'ok:1');
select pg_temp.espera('Usuário não aprova pendente',
  pg_temp.como(:U1, format('update profiles set situacao=''APROVADO'' where id=%L', :P)), 'ok:0');
select pg_temp.espera('Usuário não remove ninguém',
  pg_temp.como(:U1, format('delete from profiles where id=%L', :U2)), 'ok:0');
select pg_temp.espera('Usuário não lê o log',
  pg_temp.como(:U1, 'select * from log_auditoria'), 'ok:0');
select pg_temp.espera('Usuário não cria perfil',
  pg_temp.como(:U1, $q$insert into profiles (id,nome,email,departamento) values ('00000000-0000-0000-0000-0000000000b1','Xyz','x@vanderhulst.com.br','COMERCIAL')$q$), 'erro');
select pg_temp.espera('Funções internas bloqueadas para usuário',
  pg_temp.como(:U1, format('select perfil_de(%L)', :O)), 'erro');

-- ===== O que ADMIN pode =====
select pg_temp.espera('ADMIN lê todos os perfis',
  pg_temp.como(:A1, 'select * from profiles'), 'ok:6');
select pg_temp.espera('ADMIN aprova pendente',
  pg_temp.como(:A1, format('update profiles set situacao=''APROVADO'', decidido_por=%L, decidido_em=now() where id=%L', :A1, :P)), 'ok:1');
select pg_temp.espera('ADMIN suspende usuário',
  pg_temp.como(:A1, format('update profiles set situacao=''SUSPENSO'' where id=%L', :U2)), 'ok:1');
select pg_temp.espera('ADMIN edita usuário',
  pg_temp.como(:A1, format('update profiles set nome=''Usuario Dois Editado'' where id=%L', :U2)), 'ok:1');
select pg_temp.espera('ADMIN marca senha provisória em usuário',
  pg_temp.como(:A1, format('update profiles set senha_provisoria=true, provisoria_expira=now()+interval ''24 hours'' where id=%L', :U2)), 'ok:1');
select pg_temp.espera('ADMIN suspenso perde os poderes',
  (select pg_temp.como(:O, format('update profiles set situacao=''SUSPENSO'' where id=%L', :A2)) = 'ok:1'
     and pg_temp.como(:A2, format('update profiles set situacao=''SUSPENSO'' where id=%L', :U1)) = 'ok:0')::text, 'true');
select pg_temp.espera('ADMIN remove usuário',
  pg_temp.como(:A1, format('delete from profiles where id=%L', :U2)), 'ok:1');
select pg_temp.espera('Remover quem aprovou um ADMIN não trava (o banco limpa decidido_por)',
  (select pg_temp.como_servidor(format('update profiles set decidido_por=%L where id=%L', :U1, :A2)) = 'ok:1'
     and pg_temp.como(:A1, format('delete from profiles where id=%L', :U1)) = 'ok:1'
     and (select decidido_por from profiles where id = :A2) is null)::text, 'true');

-- ===== Regras estruturais valem até para a chave secreta (servidor) =====
select pg_temp.espera('Servidor não suspende o OWNER',
  pg_temp.como_servidor(format('update profiles set situacao=''SUSPENSO'' where id=%L', :O)), 'erro');
select pg_temp.espera('Servidor não rebaixa o OWNER',
  pg_temp.como_servidor(format('update profiles set papel=''ADMIN'' where id=%L', :O)), 'erro');
select pg_temp.espera('Servidor não remove o OWNER',
  pg_temp.como_servidor(format('delete from profiles where id=%L', :O)), 'erro');
select pg_temp.espera('Apagar o login do OWNER não apaga o perfil (cascata bloqueada)',
  pg_temp.como_servidor(format('delete from auth.users where id=%L', :O)), 'erro');
select pg_temp.espera('Não existe segundo OWNER',
  pg_temp.como_servidor(format('update profiles set papel=''OWNER'' where id=%L', :A1)), 'erro');
select pg_temp.espera('Servidor aprova e marca senha provisória (ações checadas na aplicação)',
  pg_temp.como_servidor(format('update profiles set senha_provisoria=true where id=%L', :A1)), 'ok:1');
select pg_temp.espera('E-mail de outro domínio é recusado',
  pg_temp.como_servidor($q$insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000d1','x@gmail.com');
    insert into profiles (id,nome,email,departamento) values ('00000000-0000-0000-0000-0000000000d1','Fulano','x@gmail.com','COMERCIAL')$q$), 'erro');
select pg_temp.espera('Subdomínio é recusado',
  pg_temp.como_servidor($q$insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000d2','x@sub.vanderhulst.com.br');
    insert into profiles (id,nome,email,departamento) values ('00000000-0000-0000-0000-0000000000d2','Fulano','x@sub.vanderhulst.com.br','COMERCIAL')$q$), 'erro');
select pg_temp.espera('.com (sem .br) é recusado',
  pg_temp.como_servidor($q$insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000d3','x@vanderhulst.com');
    insert into profiles (id,nome,email,departamento) values ('00000000-0000-0000-0000-0000000000d3','Fulano','x@vanderhulst.com','COMERCIAL')$q$), 'erro');
select pg_temp.espera('Maiúsculas no e-mail são recusadas pelo banco',
  pg_temp.como_servidor($q$insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000d4','X@vanderhulst.com.br');
    insert into profiles (id,nome,email,departamento) values ('00000000-0000-0000-0000-0000000000d4','Fulano','X@vanderhulst.com.br','COMERCIAL')$q$), 'erro');
rollback;

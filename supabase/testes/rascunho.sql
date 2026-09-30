-- Testes da migration 0006 (rascunho e fotos enviadas uma a uma). Falha com erro se alguma regra quebrar.
begin;

insert into laudo (id, numero_op, caminho_pdf) values
  ('00000000-0000-0000-0000-0000000000d1', '1111', null),
  ('00000000-0000-0000-0000-0000000000d2', '2222', 'x/laudo-OP-2222.pdf');

do $$
declare n int;
begin
  -- Laudo novo nasce como rascunho.
  if (select status from laudo where numero_op = '1111') <> 'RASCUNHO' then raise exception 'laudo novo deveria ser RASCUNHO'; end if;

  -- Foto reservada: sem hash nem dimensões enquanto não chega.
  insert into imagem (laudo_id, tipo, ordem, caminho_arquivo)
    values ('00000000-0000-0000-0000-0000000000d1', 'PECA', 1, 'd1/brutos/a');

  -- Marcar como recebida sem hash e dimensões é recusado.
  begin
    update imagem set recebida_em = now() where caminho_arquivo = 'd1/brutos/a';
    raise exception 'recebida sem hash deveria ser recusada';
  exception when check_violation then null;
  end;

  update imagem set recebida_em = now(), hash_sha256 = repeat('a', 64), largura = 10, altura = 10
    where caminho_arquivo = 'd1/brutos/a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'foto processada deveria ser gravada'; end if;

  -- Duas fotos com a mesma ordem no mesmo laudo continuam proibidas.
  begin
    insert into imagem (laudo_id, tipo, ordem, caminho_arquivo)
      values ('00000000-0000-0000-0000-0000000000d1', 'PECA', 1, 'd1/brutos/b');
    raise exception 'ordem repetida deveria ser recusada';
  exception when unique_violation then null;
  end;

  -- Apagar o rascunho leva as fotos junto.
  delete from laudo where id = '00000000-0000-0000-0000-0000000000d1';
  if exists (select 1 from imagem where laudo_id = '00000000-0000-0000-0000-0000000000d1') then
    raise exception 'fotos do rascunho apagado deveriam sair';
  end if;
  raise notice 'ok: regras do rascunho';
end $$;

rollback;

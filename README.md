# Automação do Laudo de Inspeção — Vanderhulst

Aplicação web que monta automaticamente o **Laudo de Inspeção de Produção** (formulário
FM QUA 004 01 rev2) em PDF. O operador abre o site no celular, digita o número da OP, fotografa o
formulário preenchido e as peças acabadas, e recebe o PDF pronto.

- Nada para instalar: roda no navegador do celular ou do computador.
- A câmera abre direto pelo navegador (`<input type="file" accept="image/*" capture="environment">`).
- O formulário entra no laudo **como imagem**, exatamente como foi fotografado. Nenhum dado é lido ou transcrito.
- Acesso restrito por senha única da fábrica; o celular lembra a senha por 180 dias.
- Identidade visual Vanderhulst no site e no PDF (`lib/marca.ts`).
- Custo de infraestrutura zero (planos gratuitos da Vercel e do Supabase — leia os [limites](#limites-dos-planos-gratuitos)).

## Telas

| Tela | Endereço | Uso |
|---|---|---|
| Entrada | `/entrar` | Senha de acesso. Todas as outras telas e APIs exigem a senha. |
| Envio | `/` | Número da OP, fotos do formulário, fotos das peças, observações. Única tela usada no chão de fábrica. |
| Confirmação | `/laudos/{id}` | Mensagem de sucesso, número da OP e botão **Baixar PDF**. |
| Histórico | `/historico` | Laudos emitidos, agrupados por dia, com busca por número da OP e ZIP de cada dia. |

## Estrutura do PDF

1. **Identificação** — OP em destaque, data e hora da emissão, resumo do conteúdo e observações (a seção é omitida se estiver vazia).
2. **Formulário FM QUA 004 01 rev2** — uma página por foto ("folha 1", "folha 2"…), com margens mínimas. A página
   fica em retrato ou paisagem conforme a foto, para o formulário sair o maior possível.
3. **Registro fotográfico das peças** — grade procedural, com cabeçalho da OP repetido em cada página.

### Alocação procedural das fotos (`lib/layout.ts`)

| Fotos na página | Disposição |
|---|---|
| 1 | largura útil, altura máxima de meia página |
| 2 | lado a lado, mesma altura (larguras proporcionais) |
| 3 | 2 em cima, 1 centralizada abaixo |
| 4 | grade 2 × 2 |
| 5 ou 6 | grade 3 × 2 (3 linhas × 2 colunas — rende fotos maiores numa página A4 em pé) |
| 7 ou mais | grade 3 × 3; o excedente vai para as páginas seguintes |

- Enquadramento *contain*: a proporção é sempre preservada, nada é cortado nem distorcido.
- Fotos de mesma orientação vão para a mesma linha sempre que possível. Com 7 fotos, a grade pode virar
  3 + 2 + 2 em vez de 3 + 3 + 1 se isso evitar misturar fotos em pé e deitadas.
- A altura da página é repartida entre as linhas: linhas de fotos deitadas recebem só o que precisam e a
  sobra vai para as linhas de fotos em pé.
- Numeração sequencial (`Foto 1`, `Foto 2`…) na ordem de leitura.
- Nunca sobra uma foto sozinha na última página: 10 fotos → 8 + 2; 19 → 9 + 8 + 2.
- Nunca há página vazia.

Exemplos: 15 fotos → 9 + 6; 30 fotos → 9 + 9 + 9 + 3.

## Processamento das imagens (`lib/reduzirFoto.ts` e `lib/imagem.ts`)

- **No celular, antes do envio**: a foto é reduzida ao tamanho que o laudo usa — **formulário até 2000 px**,
  **peças até 1280 px** no maior lado. Uma foto de 3–6 MB vira ~0,3–1 MB, e o envio fica várias vezes mais rápido
  na rede da fábrica. Se o navegador não conseguir abrir o formato, envia o original.
- **No servidor (sharp)**: rotação corrigida pelos metadados EXIF (foto tirada em pé sai em pé), redução sem
  ampliar, JPEG qualidade 85 (formulário, pela legibilidade da escrita à mão) ou 78 (peças), metadados (EXIF, GPS)
  descartados.
- **SHA-256** de cada imagem calculado no processamento e gravado no banco (tabela `imagem`). O hash é do JPEG
  exatamente como embutido no PDF.
- **Só o PDF é guardado**: as fotos ficam embutidas nele (`imagem.caminho_arquivo` aponta para o PDF). Guardar as
  fotos à parte dobraria o espaço e não caberia no plano gratuito com ~600 laudos/mês.

## Como funciona o envio

A Vercel limita cada requisição a 4,5 MB, e uma foto de celular pode passar disso. Por isso as fotos vão do
navegador **direto para o Supabase Storage**, por URLs de envio assinadas:

```
Navegador                       Servidor (Vercel)                  Supabase
   │ POST /api/laudos  ───────────► cria o laudo ─────────────────► tabela laudo
   │ ◄──────────────── URLs assinadas (uma por foto)
   │ reduz a foto no celular e envia (PUT) ────────────────────────► Storage (brutos/)
   │   … 3 fotos por vez, com barra de progresso …
   │ POST /api/laudos/{id}/pdf ────► baixa as fotos, gira, reduz,
   │                                 hash, monta o PDF ────────────► Storage (PDF) + tabela imagem
   │                                 apaga as fotos brutas;         + laudo.caminho_pdf
   │                                 depois: limpeza automática
   │ GET  /api/laudos/{id}/pdf ────► redireciona para link temporário do PDF
```

Se a conexão cair no meio, **Tentar novamente** continua de onde parou (as fotos já enviadas não são reenviadas).
O navegador nunca recebe chave do Supabase. O link de download do PDF é gerado a cada clique em
**Baixar PDF** e vale 24 horas (`VALIDADE_DOWNLOAD_S` em `lib/laudos.ts`).

## Acesso por senha

- A senha fica na variável `SENHA_ACESSO` da Vercel. Sem ela, ninguém entra (a tela de entrada avisa que falta configurar).
- Depois de digitar a senha, o navegador guarda um cookie por 180 dias; o botão **Sair** apaga.
- Para trocar a senha (por exemplo, quando alguém sai da empresa): altere `SENHA_ACESSO` na Vercel e faça
  **Redeploy**. Todos os aparelhos terão de digitar a nova senha.
- Senha errada tem espera de 1 segundo por tentativa, o que dificulta tentativas em série.
- O site pede aos buscadores para não ser indexado.

## Identidade visual

Cores e símbolo ficam em `lib/marca.ts` e são usados pelo site (`components/Logo.tsx`, `app/globals.css`) e pelo
PDF (`lib/pdf/LaudoPdf.tsx`). O símbolo (duas correias sobre três polias formando o "V") é desenhado em vetor, o
que o mantém nítido em qualquer tamanho. O nome VANDERHULST é composto em fonte negrito com espaçamento.

## Capacidade: ~600 laudos por mês no plano gratuito

Dimensionado para ~600 laudos/mês com 1 foto do formulário e 3 das peças (valores aproximados, com fotos reais):

| | Por laudo | 600 laudos/mês | Limite gratuito do Supabase |
|---|---|---|---|
| Enviado pelo celular (entrada) | ~1,5 MB | ~0,9 GB | entrada não é cobrada |
| Tráfego de saída (processar + baixar PDF + ZIP) | ~4 MB | ~2,4 GB | ~5 GB/mês |
| Armazenamento (só o PDF) | ~1,2 MB | ~0,7 GB por mês, acumulando | 1 GB no total |
| Banco de dados | < 1 KB | < 1 MB | 500 MB |

O armazenamento é o único limite que acumula. Por isso existe a **limpeza automática** (`lib/manutencao.ts`):
depois de cada laudo emitido, se o bucket passar de `LIMITE_ARMAZENAMENTO_MB` (padrão **850 MB**), os PDFs mais
antigos são apagados até voltar a caber. O laudo continua no histórico como **PDF arquivado**, com os hashes das
fotos no banco. Com 600 laudos/mês, cada PDF fica disponível por **cerca de 5 semanas** — baixe o **ZIP do dia**
(ou da semana, dia a dia) e guarde no drive, que passa a ser o arquivo definitivo. O histórico mostra o espaço em
uso e desde quando há PDFs disponíveis. A limpeza também apaga envios abandonados (fotos enviadas sem gerar o PDF)
com mais de um dia.

Requer a migration [`0003_capacidade.sql`](supabase/migrations/0003_capacidade.sql); sem ela, nada é apagado.

Na Vercel, o volume é pequeno: ~1 s de processamento por laudo (≈ 10 min/mês de CPU) e as fotos e PDFs não passam
por ela.

## ZIP dos laudos do dia

No **Histórico**, cada dia tem o botão **Baixar dd-mm.zip**; no fim da página, **ZIP de outra data** baixa qualquer
dia. O arquivo `23-09.zip` contém a pasta `23-09/` com todos os PDFs emitidos naquele dia (fuso de São Paulo), em
ordem de emissão; a mesma OP repetida no dia vira `laudo-OP-63335 (2).pdf`. É só extrair e arrastar a pasta para
`Checklist Embarque Controlado/{ano}/{mês}/` no drive.

O ZIP é montado no navegador: os PDFs vêm direto do Supabase por links temporários (10 min), sem passar pelo
limite de 4,5 MB da Vercel e sem ocupar espaço extra no Storage.

## Envio automático ao OneDrive / SharePoint (opcional, exige registro de app pela TI)

Cada laudo gerado é copiado para uma pasta do SharePoint, por exemplo
`Qualidade - Documentos/Checklist Embarque Controlado/2026/Setembro/23-09/laudo-OP-63335.pdf`.
As pastas de ano, mês (por extenso) e dia-mês são criadas quando faltam; se já existirem, são reaproveitadas
(o SharePoint não diferencia maiúsculas). Um segundo laudo da mesma OP no mesmo dia recebe um número no nome, sem
sobrescrever o primeiro.

- O envio acontece **depois** da confirmação na tela, então não atrasa o operador.
- Se falhar (rede, permissão), o laudo continua no sistema e aparece como *Envio ao OneDrive pendente* no
  histórico; em **Histórico → OneDrive → Enviar pendentes agora** ele é reenviado. O mesmo botão envia os laudos
  emitidos antes da conexão.
- Sem as variáveis abaixo, o recurso fica desligado e nada muda.

Usa a API oficial da Microsoft (Microsoft Graph) com autorização da própria Microsoft: uma pessoa com acesso à
pasta clica em **Conectar OneDrive** e entra com a conta Microsoft 365. **A senha não passa pelo sistema**; ele
guarda só uma autorização (cifrada no banco), que pode ser revogada a qualquer momento. Os arquivos aparecem no
SharePoint como criados por essa pessoa. A autorização se renova com o uso; se o sistema ficar ~90 dias parado,
é preciso conectar de novo.

### Configuração (uma vez)

1. **Banco**: no SQL Editor do Supabase, rode
   [`supabase/migrations/0002_envio_onedrive.sql`](supabase/migrations/0002_envio_onedrive.sql).
2. **Registrar o app na Microsoft** — em <https://entra.microsoft.com> (ou portal.azure.com → Microsoft Entra ID):
   1. **Registros de aplicativo → Novo registro**. Nome: `Laudos de Inspeção`. Tipos de conta: *Somente contas
      deste diretório organizacional*. URI de redirecionamento: plataforma **Web**,
      `https://SEU-SITE.vercel.app/api/onedrive/retorno` (o endereço exato do site).
   2. Na página do app, copie **ID do aplicativo (cliente)** e **ID do diretório (locatário)**.
   3. **Certificados e segredos → Novo segredo do cliente** (validade de até 24 meses). Copie o **Valor** na hora
      (ele só aparece uma vez). Anote a data de vencimento: antes dela, crie outro segredo, troque na Vercel e
      clique em Conectar de novo.
   4. **Permissões de API → Adicionar → Microsoft Graph → Permissões delegadas**: `Files.ReadWrite.All`,
      `offline_access` e `User.Read`. Se a empresa exigir, um administrador clica em
      **Conceder consentimento do administrador**.
   Se o seu usuário não puder registrar aplicativos, peça à TI para fazer os passos 2.1 a 2.4 (leva ~5 minutos).
3. **Link da pasta**: no SharePoint (navegador), abra *Qualidade → Documentos*, clique nos três pontos da pasta
   **Checklist Embarque Controlado → Copiar link**.
4. **Vercel → Settings → Environment Variables**:

   | Nome | Valor |
   |---|---|
   | `MS_TENANT_ID` | ID do diretório (locatário) |
   | `MS_CLIENT_ID` | ID do aplicativo (cliente) |
   | `MS_CLIENT_SECRET` | valor do segredo do cliente |
   | `ONEDRIVE_PASTA_LINK` | link copiado no passo 3 |

   Depois, **Redeploy**.
5. No site: **Histórico → OneDrive → Conectar OneDrive**, entre com a conta que tem acesso à pasta e aceite.
   Em seguida, **Enviar pendentes agora** manda os laudos já emitidos.

## Modelo de dados (`supabase/migrations/`)

```
laudo   id, numero_op, observacoes (nulo), criado_em, caminho_pdf (preenchido após a geração),
        pdf_removido_em (limpeza automática), onedrive_* (opcional)
imagem  id, laudo_id, tipo (FORMULARIO | PECA), caminho_arquivo (o PDF onde está embutida), hash_sha256,
        largura, altura, ordem
```

Os PDFs ficam no bucket privado `laudos`; no banco vão só caminho, hash e metadados. As fases seguintes
(dados de inspeção digitados, transcrição por IA com revisão, validação de tolerâncias) entram como tabelas e
colunas novas, sem alterar as existentes — ver comentário no fim da migration.

---

## Deploy do zero

Tudo pelo navegador. Tempo estimado: 20 minutos.

### 1. Repositório no GitHub

Tenha este código num repositório seu no GitHub (pode ser privado).

### 2. Banco e armazenamento — Supabase (plano Free)

1. Crie uma conta em <https://supabase.com> e um projeto novo (**New project**). Escolha a região
   **South America (São Paulo)** e anote a senha do banco (não será usada pela aplicação).
2. No menu lateral, abra **SQL Editor** → **New query**, cole todo o conteúdo de
   [`supabase/migrations/0001_estrutura_inicial.sql`](supabase/migrations/0001_estrutura_inicial.sql) e clique em **Run**.
   Isso cria as tabelas `laudo` e `imagem` e o bucket privado `laudos`. Depois, numa nova query, faça o mesmo
   com [`0003_capacidade.sql`](supabase/migrations/0003_capacidade.sql) (limpeza automática). A `0002` só é
   necessária para o envio ao OneDrive.
3. Confira em **Storage** que o bucket `laudos` aparece, marcado como privado.
4. Em **Project Settings → API** (ou **API Keys**), copie:
   - a **Project URL** (`https://xxxx.supabase.co`);
   - a **chave secreta** (`sb_secret_...`) ou, em projetos antigos, a chave **service_role**.
     Ela dá acesso total ao projeto: nunca a publique nem a coloque no código.

### 3. Hospedagem — Vercel (plano Hobby)

1. Crie uma conta em <https://vercel.com> entrando com o GitHub.
2. **Add New… → Project** → importe o repositório. O framework (Next.js) é detectado sozinho.
3. Em **Environment Variables**, adicione:

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do passo 2.4 |
   | `SUPABASE_SECRET_KEY` | chave secreta do passo 2.4 |
   | `SENHA_ACESSO` | senha que os operadores vão digitar para entrar no site |
   | `FUSO_HORARIO` | (opcional) padrão `America/Sao_Paulo` |
   | `LIMITE_ARMAZENAMENTO_MB` | (opcional) espaço máximo antes de apagar PDFs antigos; padrão `850` |

4. **Deploy**. Em cerca de 1 minuto a Vercel mostra a URL pública (`https://seu-projeto.vercel.app`), já com HTTPS.
5. Em **Settings → Functions**, deixe a região das funções como **São Paulo (gru1)**, perto do Supabase.

A cada `git push` na branch principal a Vercel publica a nova versão sozinha.

### 4. Teste de aceite

1. Abra a URL no celular e digite a senha de acesso. Digite uma OP, fotografe o formulário e algumas peças (inclua fotos com o celular em pé).
2. Toque em **Gerar laudo**, espere a confirmação e baixe o PDF.
3. Abra **Histórico** e busque pela OP.

Dica: no celular, use "Adicionar à tela inicial" no menu do navegador para ter um atalho (não é instalação de app).

### Editar o código sem instalar nada

- **GitHub Codespaces**: no repositório, **Code → Codespaces → Create codespace**. O ambiente já vem com Node 22
  (`.devcontainer/`). Crie um arquivo `.env.local` a partir de `.env.example` e rode `npm run dev`.
- Ou edite direto no site do GitHub: cada commit na branch principal vira um deploy.

## Desenvolvimento

```bash
npm install
npm test            # testes da grade procedural e da geração do PDF (não precisam do Supabase)
npm run exemplos    # gera PDFs de exemplo em exemplos/ com 1, 2, 3, 4, 7, 15 e 30 fotos sintéticas
npm run exemplos -- 5 12   # quantidades escolhidas
npm run dev         # servidor local (precisa de .env.local com as variáveis do Supabase)
npm run build       # build de produção + checagem de tipos
```

Os exemplos usam fotos sintéticas no padrão de celular (4032 × 3024, alguns MB, fotos em pé gravadas deitadas com
a tag EXIF de rotação), e mostram o tempo gasto. Referência medida num contêiner de 4 núcleos:
15 fotos em 1,9 s (processamento + PDF) e 30 fotos em 3,5 s.

### Organização

```
proxy.ts                         exige a senha em todas as rotas (exceto /entrar)
app/
  entrar/page.tsx                tela de senha
  (app)/page.tsx                 tela de envio
  (app)/laudos/[id]/page.tsx     confirmação
  (app)/historico/page.tsx       histórico com busca
  api/laudos/…                   criar laudo, processar foto, gerar e baixar PDF
  api/entrar, api/sair           login e logout
  (app)/onedrive/page.tsx        conectar OneDrive e reenviar pendentes
  api/onedrive/…                 conectar, retorno da Microsoft, pendentes, desconectar
  api/laudos/zip                 lista os PDFs de um dia com links temporários
components/FormularioEnvio.tsx   formulário (câmera, miniaturas, progresso, retomada)
lib/layout.ts                    alocação procedural das fotos (função pura, testada)
lib/reduzirFoto.ts               redução da foto no celular antes do envio
lib/imagem.ts                    sharp: EXIF, redução, JPEG, SHA-256
lib/manutencao.ts                limpeza automática do armazenamento
lib/pdf/                         documento @react-pdf/renderer
lib/marca.ts                     cores e símbolo Vanderhulst
lib/acesso.ts                    senha de acesso (cookie)
components/BaixarZipDia.tsx      ZIP dos laudos de um dia, montado no navegador
lib/onedrive.ts                  Microsoft Graph: autorização, pastas e envio
lib/integracao.ts                autorização do OneDrive guardada (cifrada) no banco
lib/laudos.ts                    acesso ao banco e ao Storage
supabase/migrations/             SQL do banco e do bucket
scripts/gerar-exemplos.ts        PDFs de exemplo sem Supabase
```

## Limites dos planos gratuitos

- **Uso comercial na Vercel**: o plano Hobby da Vercel é, pelos termos de uso, destinado a uso pessoal e não
  comercial. Para uso por uma empresa, verifique os termos atuais. O código não depende da Vercel: roda em
  qualquer hospedagem de Next.js com Node, como o plano gratuito da Netlify, que permite uso comercial (nesse
  caso confira o limite de tempo das funções, que é menor).
- **Supabase Free**: 1 GB de Storage, ~5 GB/mês de tráfego de saída e 500 MB de banco — ver
  [Capacidade](#capacidade-600-laudos-por-mês-no-plano-gratuito). Acompanhe em **Project Settings → Usage**.
  Laudos com muitas fotos ocupam mais (15 fotos ≈ 3 MB de PDF); a limpeza automática se ajusta sozinha.
- **Diagnóstico**: depois de entrar com a senha, abra `/api/diagnostico` para conferir variáveis, tabelas e bucket.
- **Supabase Free pausa o projeto após 7 dias sem uso**. Basta reativar no painel (**Restore project**). Em uso
  diário isso não acontece.
- Fotos em **HEIC**: o iPhone converte para JPEG ao enviar pelo navegador. Se chegar um HEIC mesmo assim, o
  sistema avisa que não conseguiu ler a foto.

## Fora do escopo desta versão

Login individual por usuário, permissões, painéis, transcrição do formulário e validação de medidas. Ver a seção de evolução
prevista na especificação: fase 2 (digitação dos dados), fase 3 (transcrição por IA com revisão humana) e
fase 4 (validação contra a tabela de tolerâncias).

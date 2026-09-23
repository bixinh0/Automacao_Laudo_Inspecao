# Automação do Laudo de Inspeção — Vanderhulst

Aplicação web que monta automaticamente o **Laudo de Inspeção de Produção** (formulário
FM PRO 001 01) em PDF. O operador abre o site no celular, digita o número da OP, fotografa o
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
| Histórico | `/historico` | Laudos emitidos, com busca por número da OP. |

## Estrutura do PDF

1. **Identificação** — OP em destaque, data e hora da emissão, resumo do conteúdo e observações (a seção é omitida se estiver vazia).
2. **Formulário FM PRO 001 01** — uma página por foto ("folha 1", "folha 2"…), com margens mínimas. A página
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

## Processamento das imagens (`lib/imagem.ts`)

- Rotação corrigida pelos metadados EXIF (foto tirada em pé sai em pé).
- Redução sem ampliar: **formulário até 2000 px** no maior lado, JPEG qualidade 85 (legibilidade da escrita à
  mão); **peças até 1600 px**, JPEG qualidade 80.
- Metadados (EXIF, GPS) descartados.
- **SHA-256** calculado no momento do upload e gravado no banco. O hash é do arquivo JPEG que fica guardado no
  Storage, o que permite conferir depois que ele não foi alterado. A foto original não é mantida (não caberia no
  plano gratuito).

## Como funciona o envio

A Vercel limita cada requisição a 4,5 MB, e uma foto de celular pode passar disso. Por isso as fotos vão do
navegador **direto para o Supabase Storage**, por URLs de envio assinadas:

```
Navegador                       Servidor (Vercel)                  Supabase
   │ POST /api/laudos  ───────────► cria o laudo ─────────────────► tabela laudo
   │ ◄──────────────── URLs assinadas (uma por foto)
   │ PUT foto original ────────────────────────────────────────────► Storage (brutos/)
   │ POST /api/laudos/{id}/imagens ► baixa, gira, reduz, hash ─────► Storage (imagens/) + tabela imagem
   │   … 3 fotos por vez, com barra de progresso …
   │ POST /api/laudos/{id}/pdf ────► monta o PDF ──────────────────► Storage + laudo.caminho_pdf
   │ GET  /api/laudos/{id}/pdf ────► redireciona para link temporário do PDF
```

Se a conexão cair no meio, **Tentar novamente** continua de onde parou (as fotos já processadas não são reenviadas).
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

## Modelo de dados (`supabase/migrations/0001_estrutura_inicial.sql`)

```
laudo   id, numero_op, observacoes (nulo), criado_em, caminho_pdf (preenchido após a geração)
imagem  id, laudo_id, tipo (FORMULARIO | PECA), caminho_arquivo, hash_sha256, largura, altura, ordem
```

Imagens e PDFs ficam no bucket privado `laudos`; no banco vão só caminho, hash e metadados. As fases seguintes
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
   Isso cria as tabelas `laudo` e `imagem` e o bucket privado `laudos`.
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
components/FormularioEnvio.tsx   formulário (câmera, miniaturas, progresso, retomada)
lib/layout.ts                    alocação procedural das fotos (função pura, testada)
lib/imagem.ts                    sharp: EXIF, redução, JPEG, SHA-256
lib/pdf/                         documento @react-pdf/renderer
lib/marca.ts                     cores e símbolo Vanderhulst
lib/acesso.ts                    senha de acesso (cookie)
lib/laudos.ts                    acesso ao banco e ao Storage
supabase/migrations/             SQL do banco e do bucket
scripts/gerar-exemplos.ts        PDFs de exemplo sem Supabase
```

## Limites dos planos gratuitos

- **Uso comercial na Vercel**: o plano Hobby da Vercel é, pelos termos de uso, destinado a uso pessoal e não
  comercial. Para uso por uma empresa, verifique os termos atuais. O código não depende da Vercel: roda em
  qualquer hospedagem de Next.js com Node, como o plano gratuito da Netlify, que permite uso comercial (nesse
  caso confira o limite de tempo das funções, que é menor).
- **Supabase Free**: 1 GB de Storage e 500 MB de banco. Um laudo com 15 fotos ocupa cerca de 6 MB (fotos
  processadas + PDF), ou seja, algo como 150 laudos desse tamanho. Acompanhe em **Project Settings → Usage**;
  quando chegar perto, apague laudos antigos (pasta do laudo no bucket + linha na tabela `laudo`) ou arquive os PDFs.
- **Diagnóstico**: depois de entrar com a senha, abra `/api/diagnostico` para conferir variáveis, tabelas e bucket.
- **Supabase Free pausa o projeto após 7 dias sem uso**. Basta reativar no painel (**Restore project**). Em uso
  diário isso não acontece.
- Fotos em **HEIC**: o iPhone converte para JPEG ao enviar pelo navegador. Se chegar um HEIC mesmo assim, o
  sistema avisa que não conseguiu ler a foto.

## Fora do escopo desta versão

Login individual por usuário, permissões, painéis, transcrição do formulário e validação de medidas. Ver a seção de evolução
prevista na especificação: fase 2 (digitação dos dados), fase 3 (transcrição por IA com revisão humana) e
fase 4 (validação contra a tabela de tolerâncias).

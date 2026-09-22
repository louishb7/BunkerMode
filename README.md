# BunkerMode

Aplicação full stack de organização pessoal, construída como uma experiência única: o Bunker. Tarefas e Objetivos são módulos independentes que cada pessoa pode habilitar conforme sua necessidade, mantendo a relação entre eles opcional.

[Live Demo](https://bunkermodeproject.vercel.app/)

## Sobre o projeto

O Bunker reúne planejamento e execução sem transformar cada capacidade em um produto separado. O módulo de Tarefas concentra o trabalho do dia; Objetivos organizam direções e podem, opcionalmente, dar contexto às tarefas.

## Funcionalidades

- Módulo de Tarefas com calendário semanal e Modo Foco.
- Tarefas pontuais ou recorrentes.
- Identificação de tarefas passadas não concluídas como “Não realizadas”.
- Módulo de Objetivos independente, com associação opcional a tarefas.
- Habilitação e desabilitação de módulos sem exclusão de dados.
- Autenticação de usuários.
- Tema Sistema, Claro e Escuro.
- Interface responsiva.

## Stack

Frontend:

- TypeScript
- React
- Vite
- Tailwind CSS

Backend:

- Node.js
- NestJS
- Prisma
- PostgreSQL

Infra e qualidade:

- Docker
- Jest
- Vercel

## Arquitetura

```text
React + Vite → API NestJS → Prisma → PostgreSQL
```

O frontend e a API ficam em diretórios independentes (`frontend/` e `api/`). A API concentra autenticação, regras de domínio e acesso ao banco.

## Executando localmente

É necessário Node.js 24 e uma instância PostgreSQL.

1. Configure a API a partir do exemplo seguro de variáveis:

   ```bash
   cd api
   cp .env.example .env
   ```

   Preencha `DATABASE_URL` e substitua `BUNKERMODE_AUTH_SECRET` por um valor local. As demais variáveis e seus exemplos estão em `api/.env.example`.

2. Instale as dependências, gere o cliente Prisma e aplique as migrations no banco local:

   ```bash
   npm ci
   npm run prisma:generate
   npm run prisma:migrate:dev
   npm run start:dev
   ```

3. Em outro terminal, inicie o frontend:

   ```bash
   cd frontend
   npm ci
   npm run dev
   ```

Por padrão, o frontend usa `http://127.0.0.1:3000/api/v2`. Para apontá-lo a outra API, defina `VITE_API_URL` antes de executar `npm run dev`.

## Recuperação de senha

Na API, configure `FRONTEND_URL` (origem pública do frontend, HTTPS em produção),
`RESEND_API_KEY` (chave com permissão de envio) e `EMAIL_FROM` (remetente de um domínio
verificado no Resend). Configure os registros DNS pedidos pelo provider e desative
tracking de links para esses e-mails. A implementação usa a [API de envio do Resend](https://resend.com/docs/api-reference/emails/send-email).
Não exponha essas variáveis como `VITE_*`. Sem configuração, a solicitação retorna
indisponibilidade genérica para qualquer endereço.

`POST /api/v2/auth/forgot-password` recebe `{ "email": "..." }` e devolve a mesma
mensagem para contas existentes e inexistentes. O envio ocorre em segundo plano no
processo da API Docker, para não denunciar existência da conta pelo tempo do provider.
Falhas geram somente um log genérico, sem destinatário, conteúdo ou token. O shutdown
normal aguarda os envios; não há fila durável nem retentativa automática se o processo
for encerrado abruptamente.

`POST /api/v2/auth/reset-password` recebe `{ "token": "...", "password": "..." }`.
Os links apontam para `/reset-password?token=...`, expiram em 30 minutos e são de uso
único. Ao gerar um novo link, os resets pendentes anteriores da conta são invalidados.
Somente SHA-256 do token fica no banco. Senhas continuam usando scrypt, com
validação de cinco letras Unicode e ao menos um dígito decimal Unicode, sem requisitos
adicionais de composição ou comprimento. O limite geral de corpo HTTP continua vigente.

O reset bloqueia a linha do usuário em transação, consome o token, atualiza o hash,
incrementa `auth_version` e invalida os outros tokens pendentes. JWTs antigos sem versão
são aceitos apenas enquanto o usuário estiver na versão inicial `0`; após reset, todas
as sessões anteriores recebem 401. Usuários existentes recebem esse default na migration.

Limites: recuperação, 5 solicitações por IP e 3 por e-mail normalizado a cada 15 minutos;
redefinição, 10 tentativas por IP a cada 15 minutos. Usa o limitador em memória existente:
em múltiplas réplicas, configure também limitação compartilhada no proxy/gateway. Além
disso, o PostgreSQL limita cada conta a 1 envio a cada 2 minutos, 3 por hora e 5 por 24
horas, com teto global de 50 envios por 24 horas. A API confia em um salto de proxy em
produção; restrinja acesso direto e preserve essa topologia.

Não habilite logs de corpos de requisição, cabeçalhos de autorização ou query strings
de `/reset-password` no proxy, hospedagem ou APM. A página aplica `no-referrer` e `no-store`
na Vercel e remove o token da URL após montar; o primeiro acesso ainda chega à hospedagem
com a query string. Não adicionar analytics nessa rota. Recarregar após a remoção da query
exige reabrir o link do e-mail. Tokens usados/expirados permanecem para inspeção; poderão
ser removidos por uma rotina operacional futura.

Deploy: com backup e as variáveis configuradas, aplique a migration aditiva antes de
subir a nova API (não usar `migrate reset`):

```bash
cd api
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
npm run start
```

O Dockerfile já gera Prisma no build e executa `prisma:migrate:deploy` na inicialização.
Publique também o frontend com `cd frontend && npm ci && npm run build`; a configuração
Vercel existente mantém o acesso direto a `/reset-password`. Teste um envio real após
configurar domínio e credenciais; os testes automatizados substituem somente o envio.

Os testes de persistência usam exclusivamente um banco isolado e migrado, indicado por
`TEST_DATABASE_URL`; sem essa variável, Jest os marca como ignorados:

```bash
cd api
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate:deploy
npm test
```

## Testes e qualidade

Backend:

```bash
cd api
npm run lint
npm run build
npm test
npm run prisma:validate
```

Frontend:

```bash
cd frontend
npm run lint
npm run check
npm run format:check
node --test test/*.test.mjs
```

# IMOBX -- Arquitetura Tecnica

**Versao:** 1.0.0
**Data:** 2026-03-04
**Autora:** Aria (Architect Agent)
**Status:** Draft

---

## Indice

1. [Visao Geral do Sistema](#1-visao-geral-do-sistema)
2. [Componentes do Sistema](#2-componentes-do-sistema)
3. [Fluxos de Dados](#3-fluxos-de-dados)
4. [Schema do Banco de Dados](#4-schema-do-banco-de-dados)
5. [Design dos Agentes](#5-design-dos-agentes)
6. [Sistema de Memoria](#6-sistema-de-memoria)
7. [Learning Engine](#7-learning-engine)
8. [Estrategia Multi-Tenancy](#8-estrategia-multi-tenancy)
9. [Consideracoes de Seguranca](#9-consideracoes-de-seguranca)
10. [Plano de Escalabilidade](#10-plano-de-escalabilidade)

---

## 1. Visao Geral do Sistema

### 1.1 Diagrama de Arquitetura

```
                          WHATSAPP BUSINESS
                                |
                                | (mensagens)
                                v
                    +------------------------+
                    |    EVOLUTION API v2     |
                    |    (self-hosted:8080)   |
                    +------------------------+
                                |
                                | POST /webhook/message
                                v
+-----------------------------------------------------------------------+
|                        API GATEWAY (Fastify :3000)                     |
|                                                                       |
|   +-------------------+    +-------------------+    +---------------+ |
|   | Webhook Receiver  |    | Auth Middleware    |    | Rate Limiter  | |
|   | (signature check) |    | (tenant API key)  |    | (per tenant)  | |
|   +-------------------+    +-------------------+    +---------------+ |
|               |                                                       |
|               v                                                       |
|   +-------------------+                                               |
|   | Message Publisher  |--> BullMQ Queue                              |
|   +-------------------+                                               |
+-----------------------------------------------------------------------+
                                |
                                | job published
                                v
+-----------------------------------------------------------------------+
|                      MESSAGE WORKER (BullMQ)                          |
|                                                                       |
|   +--------+    +--------+    +--------+    +--------+    +--------+  |
|   | Context |    |  Cat   |    |  Vera  |    |   Cy   |    | Atlas  |  |
|   | Builder |--->| (tag)  |--->| (resp) |--->| (copy) |--->|(decide)|  |
|   +--------+    +--------+    +--------+    +--------+    +--------+  |
|       |              |             |              |             |      |
|       v              v             v              v             v      |
|   +--------+    +--------+    +--------+    +--------+    +--------+  |
|   | Redis  |    | Lead   |    | Claude |    | Claude |    | Escala |  |
|   | Memory |    | Score  |    |  API   |    |  API   |    | Check  |  |
|   +--------+    +--------+    +--------+    +--------+    +--------+  |
+-----------------------------------------------------------------------+
        |                                              |
        v                                              v
+----------------+                        +---------------------+
| POSTGRESQL 16  |                        | EVOLUTION API v2    |
| + pgvector     |                        | (send response)     |
|                |                        +---------------------+
| - tenants      |
| - conversations|         +----------------------------+
| - messages     |         |     LEARNING ENGINE        |
| - leads        |         |     (Cron / Leo Agent)     |
| - properties   |         |                            |
| - embeddings   |         | Analisa conversas a cada 6h|
+----------------+         | Atualiza knowledge base   |
        ^                  | Propoe melhorias de prompt |
        |                  +----------------------------+
        +------------------+
```

### 1.2 Principios de Arquitetura

| Principio | Descricao |
|-----------|-----------|
| **Async-first** | Toda mensagem e processada via fila. Nenhum webhook bloqueia a resposta HTTP. |
| **Tenant isolation** | Dados de cada imobiliaria sao isolados por `tenant_id` em todas as tabelas. |
| **Agent pipeline** | Agentes executam em sequencia deterministica (Cat -> Vera -> Cy -> Atlas). |
| **Memory-aware** | Cada interacao acessa historico do cliente para personalizacao contextual. |
| **Fail-safe** | Se qualquer agente falhar, mensagem padrao e enviada + alerta para corretor. |
| **Idempotent** | Webhook retry nao causa mensagens duplicadas (dedup por message_id). |

### 1.3 Tech Stack

| Camada | Tecnologia | Justificativa |
|--------|------------|---------------|
| WhatsApp | Evolution API v2 (self-hosted) | Controle total, sem vendor lock-in, suporta multi-device |
| API Gateway | Node.js + Fastify | Melhor performance que Express, schema validation nativo |
| Fila | BullMQ + Redis | Retry automatico, dead letter queue, rate limiting built-in |
| IA (atendimento) | Claude claude-sonnet-4-6 | Melhor raciocinio em portugues, context window grande |
| IA (analise) | OpenAI GPT-4o | Custo-beneficio para tarefas de categorizacao |
| Banco principal | PostgreSQL 16 | ACID, jsonb, extensivel com pgvector |
| Busca semantica | pgvector | Busca por similaridade de imoveis sem infra extra |
| Cache/Sessao | Redis | Sub-millisecond reads, TTL nativo, pub/sub |
| Process Manager | PM2 | Restart automatico, cluster mode, logs centralizados |
| Proxy reverso | Nginx | TLS termination, rate limiting, caching estatico |

---

## 2. Componentes do Sistema

### 2.1 API Gateway (`apps/api/`)

Fastify server que recebe webhooks da Evolution API e publica jobs no BullMQ.

```
apps/api/
  src/
    server.ts              # Fastify bootstrap, plugins, hooks
    routes/
      webhook.ts           # POST /webhook/message (Evolution API)
      health.ts            # GET /health (monitoring)
      tenants.ts           # CRUD tenants (admin)
      properties.ts        # CRUD imoveis (admin/import)
    middleware/
      auth.ts              # Validacao de API key por tenant
      rate-limit.ts        # Rate limiting por tenant (BullMQ-based)
      signature.ts         # Validacao de assinatura Evolution API
    plugins/
      redis.ts             # Conexao Redis (fastify-redis)
      postgres.ts          # Conexao PostgreSQL (pg pool)
      bullmq.ts            # Producer de filas
    types/
      webhook.ts           # Tipos de payload da Evolution API
      tenant.ts            # Tipos de tenant
```

**Responsabilidades:**
- Validar assinatura do webhook da Evolution API
- Fazer dedup de mensagens (por `message_id` + cache Redis 5min)
- Publicar job na fila `message:incoming` com payload normalizado
- Responder 200 imediatamente (nao bloquear webhook)
- Servir endpoints administrativos (CRUD tenants, imoveis)

**Decisoes de design:**
- Fastify com schema validation (Typebox) em todas as rotas
- Connection pool PostgreSQL (max 20 conexoes por worker)
- Redis connection compartilhada entre rate limiter e dedup cache
- Graceful shutdown: drena conexoes antes de parar

### 2.2 Message Worker (`apps/api/src/workers/`)

BullMQ worker que processa mensagens da fila e orquestra o pipeline de agentes.

```
apps/api/src/workers/
  message-worker.ts        # Worker principal (consume message:incoming)
  orchestrator.ts          # Pipeline sequencial de agentes
  context-builder.ts       # Monta contexto completo para agentes
```

**Pipeline de execucao:**

```
Job recebido
    |
    v
[Context Builder]  -- busca historico Redis + PostgreSQL
    |                 busca lead profile
    |                 busca imoveis relevantes (se aplicavel)
    v
[Cat Agent]        -- categoriza mensagem, atualiza lead score
    |
    v
[Vera Agent]       -- gera resposta com contexto completo
    |
    v
[Cy Agent]         -- humaniza resposta, adiciona CTAs
    |
    v
[Atlas Agent]      -- decide: enviar IA response OU escalar para humano
    |
    +---> [Evolution API]  enviar mensagem
    |
    +---> [PostgreSQL]     salvar conversa + metricas
    |
    +---> [Redis]          atualizar sessao ativa
```

**Configuracao BullMQ:**

```typescript
const workerOptions = {
  concurrency: 5,                    // 5 jobs em paralelo por worker
  limiter: { max: 100, duration: 60000 }, // max 100 msgs/min por worker
  attempts: 3,                       // retry 3x em caso de falha
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s
  removeOnComplete: { count: 1000 }, // mantem ultimos 1000 completados
  removeOnFail: { count: 5000 },     // mantem ultimos 5000 falhados
};
```

### 2.3 Squad de Agentes (`apps/agents/`)

```
apps/agents/
  src/
    base-agent.ts          # Classe abstrata com interface comum
    atlas/
      agent.ts             # CEO Agent - supervisao e escalacao
      prompts.ts           # System prompts do Atlas
      rules.ts             # Regras de escalacao
    vera/
      agent.ts             # Attendant Agent - conversa principal
      prompts.ts           # System prompts da Vera
      tools.ts             # Tool definitions (busca imoveis, agenda visita)
    cy/
      agent.ts             # Copywriter Agent - pos-processamento
      prompts.ts           # System prompts do Cy
      templates.ts         # Templates de mensagem WhatsApp
    cat/
      agent.ts             # Categorizer Agent - classificacao
      prompts.ts           # System prompts do Cat
      schema.ts            # Schema de categorizacao (lead profile)
    leo/
      agent.ts             # Analyst Agent - analise periodica
      prompts.ts           # System prompts do Leo
      cron.ts              # Scheduler de analise
    shared/
      types.ts             # Tipos compartilhados entre agentes
      context.ts           # AgentContext interface
      response.ts          # AgentResponse interface
```

### 2.4 Packages Compartilhados (`packages/`)

```
packages/
  evolution/               # Cliente Evolution API
    src/
      client.ts            # Wrapper HTTP para Evolution API
      types.ts             # Tipos de mensagem, contato, etc.
      formatter.ts         # Formata mensagens para WhatsApp (bold, italic, lists)

  memory/                  # Camada de memoria unificada
    src/
      session-memory.ts    # Redis: sessao ativa (ultimas N mensagens)
      long-term-memory.ts  # PostgreSQL: historico completo
      semantic-memory.ts   # pgvector: embeddings de preferencias
      memory-manager.ts    # Facade que unifica as 3 camadas

  ai/                      # Wrappers de IA
    src/
      claude.ts            # Wrapper Anthropic SDK (atendimento)
      openai.ts            # Wrapper OpenAI SDK (categorizacao)
      prompt-builder.ts    # Construtor de prompts com contexto
      token-counter.ts     # Estimativa de tokens por request

  property-db/             # Acesso ao banco de imoveis
    src/
      repository.ts        # CRUD imoveis
      search.ts            # Busca semantica (pgvector)
      embeddings.ts        # Gerar embeddings de descricoes
      types.ts             # Property types

  learning/                # Learning engine
    src/
      analyzer.ts          # Analisa conversas
      pattern-detector.ts  # Detecta padroes de sucesso/falha
      prompt-optimizer.ts  # Propoe melhorias de prompts
      report-generator.ts  # Gera relatorios
```

---

## 3. Fluxos de Dados

### 3.1 Fluxo: Mensagem Recebida (Happy Path)

```
Timeline (tipico: 2-5 segundos total)

T+0ms    Evolution API envia POST /webhook/message
T+5ms    API valida assinatura, faz dedup check (Redis GET)
T+10ms   Job publicado no BullMQ queue "message:incoming"
T+15ms   API responde 200 OK ao webhook
         ---
T+50ms   Worker pega o job
T+60ms   Context Builder: Redis GET sessao (ultimas 10 msgs)
T+80ms   Context Builder: PostgreSQL query lead profile
T+100ms  Context Builder: pgvector query imoveis similares (se lead tem preferencias)
T+120ms  Cat agent: OpenAI GPT-4o categoriza (intent, sentiment, lead_score update)
T+500ms  Cat retorna categorizacao
T+520ms  Vera agent: Claude claude-sonnet-4-6 gera resposta com contexto completo
T+2500ms Vera retorna resposta
T+2520ms Cy agent: Claude claude-sonnet-4-6 humaniza + formata WhatsApp
T+3000ms Cy retorna mensagem final
T+3020ms Atlas agent: regras deterministicas (sem LLM call para decisao simples)
T+3050ms Evolution API: POST sendMessage
T+3100ms PostgreSQL: INSERT conversation + message
T+3120ms Redis: SET sessao atualizada (TTL 24h)
T+3150ms Job marcado como completed
```

### 3.2 Fluxo: Escalacao para Corretor Humano

```
Trigger: Atlas detecta criterio de escalacao
  - Lead score > 80 (pronto para visita)
  - Cliente pediu explicitamente para falar com humano
  - 3+ perguntas sobre financiamento/documentacao
  - Negociacao de preco ativa

Acao:
  1. Vera gera mensagem de transicao ("Vou conectar voce com nosso consultor...")
  2. Atlas registra escalacao na tabela "escalations"
  3. Notificacao enviada ao corretor (WhatsApp via grupo interno)
  4. Conversa marcada como "human_takeover" no Redis
  5. Proximas mensagens do cliente sao encaminhadas ao corretor
  6. Corretor pode devolver conversa ao bot via comando "/bot resume"
```

### 3.3 Fluxo: Busca de Imoveis

```
Cliente: "Procuro apartamento 3 quartos no Jardins ate 800 mil"
                                    |
                                    v
                           [Cat categoriza]
                           intent: property_search
                           property_type: apartamento
                           bedrooms: 3
                           neighborhood: Jardins
                           max_price: 800000
                                    |
                                    v
                           [Vera recebe contexto]
                           Tool call: search_properties({
                             type: 'apartamento',
                             bedrooms: { min: 3 },
                             neighborhood: 'Jardins',
                             price: { max: 800000 },
                             tenant_id: 'xxx'
                           })
                                    |
                                    v
                           [property-db/search.ts]
                           1. Gera embedding do texto da busca
                           2. Query pgvector: cosine similarity > 0.7
                           3. Filtra por campos estruturados (quartos, preco)
                           4. Retorna top 5 resultados
                                    |
                                    v
                           [Vera monta resposta]
                           "Encontrei 3 opcoes otimas pra voce:
                            1. Apt 3 quartos - R$ 750.000 - Rua X
                            2. Apt 3 suites - R$ 790.000 - Rua Y
                            3. Apt 3 quartos c/ vaga - R$ 800.000 - Rua Z
                            Quer saber mais detalhes de algum?"
                                    |
                                    v
                           [Cy humaniza + formata WhatsApp]
                           Adiciona emojis, formatacao bold, CTA
```

### 3.4 Fluxo: Learning Engine (Cron)

```
Cron trigger: a cada 6 horas
                |
                v
[Leo Agent: Coleta]
  - PostgreSQL: SELECT conversas das ultimas 6h
  - Agrupa por tenant
  - Calcula metricas por tenant:
    * taxa de resposta do cliente (engagement)
    * taxa de escalacao (bot -> humano)
    * ponto medio de abandono (mensagem N)
    * objeccoes mais comuns
    * perguntas sem resposta adequada
                |
                v
[Leo Agent: Analise]
  - OpenAI GPT-4o analisa batch de conversas
  - Identifica padroes:
    * Mensagens que geraram respostas positivas
    * Mensagens que causaram abandono
    * Objecoes mais efetivamente tratadas
    * Gaps na knowledge base
                |
                v
[Leo Agent: Output]
  - INSERT analysis_reports (relatorio completo)
  - INSERT prompt_suggestions (sugestoes de melhoria)
  - UPDATE knowledge_base (FAQs novas detectadas)
  - Metricas salvas para dashboard
```

---

## 4. Schema do Banco de Dados

### 4.1 Diagrama ER (Tabelas Principais)

```
tenants                    contacts                    conversations
+------------------+       +-------------------+       +--------------------+
| id (uuid) PK     |       | id (uuid) PK      |       | id (uuid) PK       |
| name             |       | tenant_id FK       |       | tenant_id FK        |
| slug             |       | phone_hash         |       | contact_id FK       |
| plan             |       | phone_display      |       | status              |
| api_key_hash     |       | name               |       | started_at          |
| evolution_config |       | lead_score (0-100) |       | ended_at            |
| ai_config        |       | lead_stage         |       | escalated_at        |
| max_agents       |       | preferences (jsonb)|       | escalated_to        |
| active           |       | tags (text[])      |       | messages_count      |
| created_at       |       | first_contact_at   |       | agent_messages      |
| updated_at       |       | last_contact_at    |       | human_messages      |
+------------------+       | created_at         |       | metadata (jsonb)    |
        |                  | updated_at         |       | created_at          |
        |                  +-------------------+       +--------------------+
        |                          |                            |
        |                          |                            |
        v                          v                            v
properties                 messages                     lead_events
+------------------+       +-------------------+       +--------------------+
| id (uuid) PK     |       | id (uuid) PK      |       | id (uuid) PK       |
| tenant_id FK     |       | conversation_id FK |       | contact_id FK       |
| external_id      |       | sender_type        |       | tenant_id FK        |
| type             |       | content            |       | event_type          |
| title            |       | media_type         |       | old_value           |
| description      |       | media_url          |       | new_value           |
| price            |       | wa_message_id      |       | metadata (jsonb)    |
| bedrooms         |       | agent_name         |       | created_at          |
| bathrooms        |       | tokens_used        |       +--------------------+
| area_m2          |       | latency_ms         |
| neighborhood     |       | created_at         |       escalations
| city             |       +-------------------+       +--------------------+
| state            |                                    | id (uuid) PK       |
| address          |       knowledge_base              | conversation_id FK  |
| latitude         |       +-------------------+       | tenant_id FK        |
| longitude        |       | id (uuid) PK      |       | reason              |
| amenities (jsonb)|       | tenant_id FK       |       | assigned_to         |
| images (text[])  |       | category           |       | resolved_at         |
| status           |       | question           |       | resolution_notes    |
| embedding vector |       | answer             |       | created_at          |
| created_at       |       | source             |       +--------------------+
| updated_at       |       | usage_count        |
+------------------+       | embedding vector   |       analysis_reports
                           | active             |       +--------------------+
                           | created_at         |       | id (uuid) PK       |
                           | updated_at         |       | tenant_id FK        |
                           +-------------------+       | period_start        |
                                                        | period_end          |
prompt_versions                                         | metrics (jsonb)     |
+------------------+                                    | insights (jsonb)    |
| id (uuid) PK     |                                    | suggestions (jsonb) |
| tenant_id FK     |                                    | created_at          |
| agent_name       |                                    +--------------------+
| prompt_type      |
| content          |
| version          |
| active           |
| performance (jsonb)|
| created_at       |
+------------------+
```

### 4.2 DDL -- Tabelas Principais

```sql
-- Extensoes necessarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- ============================================================
-- TENANTS (imobiliarias)
-- ============================================================
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'starter'
                    CHECK (plan IN ('starter', 'professional', 'enterprise')),
    api_key_hash    TEXT NOT NULL UNIQUE,
    evolution_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- evolution_config: { instanceName, apiUrl, apiKey, webhookUrl }
    ai_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- ai_config: { primaryModel, temperature, maxTokens, systemPromptOverrides }
    max_concurrent_chats  INTEGER NOT NULL DEFAULT 50,
    monthly_message_limit INTEGER NOT NULL DEFAULT 10000,
    messages_used_this_month INTEGER NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_api_key ON tenants(api_key_hash);

-- ============================================================
-- CONTACTS (clientes/leads)
-- ============================================================
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_hash      TEXT NOT NULL,
    -- phone_hash = SHA256(phone_number + tenant_id) para privacidade
    phone_display   TEXT NOT NULL,
    -- phone_display = ultimos 4 digitos mascarados: ***-****-1234
    name            TEXT,
    lead_score      INTEGER NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
    lead_stage      TEXT NOT NULL DEFAULT 'new'
                    CHECK (lead_stage IN (
                        'new', 'engaged', 'interested',
                        'qualified', 'visiting', 'negotiating',
                        'converted', 'lost'
                    )),
    preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- preferences: { propertyTypes, neighborhoods, priceRange, bedrooms, amenities }
    tags            TEXT[] DEFAULT '{}',
    first_contact_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_contact_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, phone_hash)
);

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_phone ON contacts(tenant_id, phone_hash);
CREATE INDEX idx_contacts_score ON contacts(tenant_id, lead_score DESC);
CREATE INDEX idx_contacts_stage ON contacts(tenant_id, lead_stage);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'human_takeover', 'closed', 'abandoned')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    escalated_at    TIMESTAMPTZ,
    escalated_to    TEXT,           -- nome/ID do corretor
    messages_count  INTEGER NOT NULL DEFAULT 0,
    agent_messages  INTEGER NOT NULL DEFAULT 0,
    human_messages  INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- metadata: { channel, trigger, initialIntent, satisfaction }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_status ON conversations(tenant_id, status);
CREATE INDEX idx_conversations_date ON conversations(tenant_id, started_at DESC);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type     TEXT NOT NULL CHECK (sender_type IN ('client', 'agent', 'human')),
    content         TEXT NOT NULL,
    media_type      TEXT,          -- image, audio, video, document, null
    media_url       TEXT,
    wa_message_id   TEXT,          -- ID original do WhatsApp (para dedup)
    agent_name      TEXT,          -- qual agente gerou (vera, cy, atlas)
    tokens_used     INTEGER DEFAULT 0,
    latency_ms      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_wa_id ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ============================================================
-- PROPERTIES (catalogo de imoveis)
-- ============================================================
CREATE TABLE properties (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    external_id     TEXT,          -- ID no sistema da imobiliaria
    type            TEXT NOT NULL CHECK (type IN (
                        'apartamento', 'casa', 'cobertura', 'studio',
                        'terreno', 'sala_comercial', 'loja', 'galpao'
                    )),
    transaction     TEXT NOT NULL DEFAULT 'sale'
                    CHECK (transaction IN ('sale', 'rent')),
    title           TEXT NOT NULL,
    description     TEXT,
    price           NUMERIC(12,2) NOT NULL,
    condo_fee       NUMERIC(10,2),
    iptu            NUMERIC(10,2),
    bedrooms        INTEGER,
    bathrooms       INTEGER,
    parking_spots   INTEGER,
    area_m2         NUMERIC(8,2),
    neighborhood    TEXT NOT NULL,
    city            TEXT NOT NULL DEFAULT 'Sao Paulo',
    state           TEXT NOT NULL DEFAULT 'SP',
    address         TEXT,
    zip_code        TEXT,
    latitude        NUMERIC(10,8),
    longitude       NUMERIC(11,8),
    amenities       JSONB DEFAULT '[]'::jsonb,
    -- amenities: ["piscina", "academia", "churrasqueira", "portaria_24h"]
    images          TEXT[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'reserved', 'sold', 'rented', 'inactive')),
    embedding       vector(1536),  -- OpenAI text-embedding-3-small
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, external_id)
);

CREATE INDEX idx_properties_tenant ON properties(tenant_id);
CREATE INDEX idx_properties_search ON properties(tenant_id, type, status)
    WHERE status = 'active';
CREATE INDEX idx_properties_price ON properties(tenant_id, price)
    WHERE status = 'active';
CREATE INDEX idx_properties_location ON properties(tenant_id, neighborhood, city)
    WHERE status = 'active';
CREATE INDEX idx_properties_embedding ON properties
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ============================================================
-- LEAD_EVENTS (historico de mudancas no lead)
-- ============================================================
CREATE TABLE lead_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    -- event_types: score_change, stage_change, preference_update,
    --              tag_added, tag_removed, property_viewed, visit_scheduled
    old_value       TEXT,
    new_value       TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_events_contact ON lead_events(contact_id, created_at DESC);

-- ============================================================
-- ESCALATIONS
-- ============================================================
CREATE TABLE escalations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL,
    -- reasons: high_score, human_request, complex_question,
    --          price_negotiation, financing, documentation
    assigned_to     TEXT,
    resolved_at     TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_tenant ON escalations(tenant_id, created_at DESC);
CREATE INDEX idx_escalations_pending ON escalations(tenant_id)
    WHERE resolved_at IS NULL;

-- ============================================================
-- KNOWLEDGE_BASE (FAQ e respostas padrao)
-- ============================================================
CREATE TABLE knowledge_base (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category        TEXT NOT NULL,
    -- categories: financing, documentation, neighborhood, negotiation,
    --             general, property_type, process
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'learned', 'imported')),
    usage_count     INTEGER NOT NULL DEFAULT 0,
    embedding       vector(1536),
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kb_tenant ON knowledge_base(tenant_id, category)
    WHERE active = true;
CREATE INDEX idx_kb_embedding ON knowledge_base
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- ============================================================
-- PROMPT_VERSIONS (versionamento de prompts)
-- ============================================================
CREATE TABLE prompt_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_name      TEXT NOT NULL CHECK (agent_name IN ('atlas', 'vera', 'cy', 'cat', 'leo')),
    prompt_type     TEXT NOT NULL CHECK (prompt_type IN ('system', 'user_template', 'few_shot')),
    content         TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    active          BOOLEAN NOT NULL DEFAULT true,
    performance     JSONB DEFAULT '{}'::jsonb,
    -- performance: { avgLatencyMs, avgTokens, satisfactionScore, conversionRate }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, agent_name, prompt_type, version)
);

-- ============================================================
-- ANALYSIS_REPORTS (relatorios do Leo)
-- ============================================================
CREATE TABLE analysis_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- metrics: { totalConversations, avgResponseTime, escalationRate,
    --            engagementRate, topIntents, abandonmentPoints }
    insights        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- insights: [{ type, description, severity, recommendation }]
    suggestions     JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- suggestions: [{ agentName, currentPrompt, suggestedChange, reason }]
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_tenant ON analysis_reports(tenant_id, period_end DESC);

-- ============================================================
-- MESSAGE_DEDUP (idempotencia de webhooks)
-- ============================================================
CREATE TABLE message_dedup (
    wa_message_id   TEXT PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-cleanup: particionar por mes ou TTL via pg_cron
CREATE INDEX idx_dedup_cleanup ON message_dedup(processed_at);
```

### 4.3 Funcoes RPC

```sql
-- Busca semantica de imoveis
CREATE OR REPLACE FUNCTION search_properties_semantic(
    p_tenant_id UUID,
    p_query_embedding vector(1536),
    p_filters JSONB DEFAULT '{}',
    p_limit INTEGER DEFAULT 5,
    p_min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    type TEXT,
    price NUMERIC,
    bedrooms INTEGER,
    neighborhood TEXT,
    description TEXT,
    images TEXT[],
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.type,
        p.price,
        p.bedrooms,
        p.neighborhood,
        p.description,
        p.images,
        1 - (p.embedding <=> p_query_embedding) AS similarity
    FROM properties p
    WHERE p.tenant_id = p_tenant_id
      AND p.status = 'active'
      AND (p_filters->>'type' IS NULL OR p.type = p_filters->>'type')
      AND (p_filters->>'min_bedrooms' IS NULL
           OR p.bedrooms >= (p_filters->>'min_bedrooms')::integer)
      AND (p_filters->>'max_price' IS NULL
           OR p.price <= (p_filters->>'max_price')::numeric)
      AND (p_filters->>'neighborhood' IS NULL
           OR p.neighborhood ILIKE '%' || (p_filters->>'neighborhood') || '%')
      AND (1 - (p.embedding <=> p_query_embedding)) >= p_min_similarity
    ORDER BY p.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Busca semantica na knowledge base
CREATE OR REPLACE FUNCTION search_knowledge_base(
    p_tenant_id UUID,
    p_query_embedding vector(1536),
    p_limit INTEGER DEFAULT 3,
    p_min_similarity FLOAT DEFAULT 0.75
)
RETURNS TABLE (
    id UUID,
    category TEXT,
    question TEXT,
    answer TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.category,
        kb.question,
        kb.answer,
        1 - (kb.embedding <=> p_query_embedding) AS similarity
    FROM knowledge_base kb
    WHERE kb.tenant_id = p_tenant_id
      AND kb.active = true
      AND (1 - (kb.embedding <=> p_query_embedding)) >= p_min_similarity
    ORDER BY kb.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Atualiza lead score com auditoria
CREATE OR REPLACE FUNCTION update_lead_score(
    p_contact_id UUID,
    p_delta INTEGER,
    p_reason TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_old_score INTEGER;
    v_new_score INTEGER;
    v_tenant_id UUID;
BEGIN
    SELECT lead_score, tenant_id INTO v_old_score, v_tenant_id
    FROM contacts WHERE id = p_contact_id;

    v_new_score := GREATEST(0, LEAST(100, v_old_score + p_delta));

    UPDATE contacts
    SET lead_score = v_new_score, updated_at = NOW()
    WHERE id = p_contact_id;

    INSERT INTO lead_events (contact_id, tenant_id, event_type, old_value, new_value, metadata)
    VALUES (
        p_contact_id, v_tenant_id, 'score_change',
        v_old_score::text, v_new_score::text,
        jsonb_build_object('delta', p_delta, 'reason', p_reason)
    );

    RETURN v_new_score;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Design dos Agentes

### 5.1 Base Agent (Interface Comum)

```typescript
interface AgentContext {
  tenantId: string;
  contactId: string;
  conversationId: string;
  message: IncomingMessage;
  sessionHistory: Message[];      // ultimas N mensagens (Redis)
  leadProfile: LeadProfile;       // perfil do lead (PostgreSQL)
  relevantProperties: Property[]; // imoveis similares (pgvector)
  knowledgeBase: KBEntry[];       // FAQs relevantes (pgvector)
  tenantConfig: TenantConfig;     // configuracoes do tenant
}

interface AgentResponse {
  agentName: string;
  content: string;
  metadata: {
    tokensUsed: number;
    latencyMs: number;
    model: string;
    confidence: number;       // 0-1, auto-avaliacao
  };
  sideEffects?: {
    leadScoreDelta?: number;
    leadStageChange?: string;
    tagsToAdd?: string[];
    preferencesUpdate?: Record<string, unknown>;
    escalate?: { reason: string; assignTo?: string };
    propertiesShown?: string[];  // IDs de imoveis mostrados
  };
}

abstract class BaseAgent {
  abstract name: string;
  abstract model: 'claude' | 'openai';

  abstract execute(context: AgentContext): Promise<AgentResponse>;

  protected async callLLM(
    systemPrompt: string,
    userMessage: string,
    options?: LLMOptions
  ): Promise<LLMResponse>;

  protected buildPrompt(
    template: string,
    variables: Record<string, unknown>
  ): string;
}
```

### 5.2 Cat (Categorizer Agent)

**Modelo:** OpenAI GPT-4o (custo-beneficio para classificacao)
**Latencia alvo:** < 500ms
**Custo medio:** ~$0.002/mensagem

**Responsabilidades:**
- Classificar intent da mensagem (greeting, property_search, price_question, visit_request, complaint, etc.)
- Extrair entidades: tipo imovel, bairro, faixa de preco, quantidade de quartos
- Atualizar lead score (+5 para interesse, +10 para visita, +20 para negociacao)
- Detectar sentiment (positivo, neutro, negativo, frustrado)
- Atualizar lead_stage quando aplicavel

**Schema de output:**

```typescript
interface CatOutput {
  intent: string;
  subIntent?: string;
  entities: {
    propertyType?: string;
    neighborhoods?: string[];
    priceRange?: { min?: number; max?: number };
    bedrooms?: { min?: number; max?: number };
    amenities?: string[];
    urgency?: 'low' | 'medium' | 'high';
  };
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  leadScoreDelta: number;
  leadStageChange?: string;
  requiresPropertySearch: boolean;
  requiresKnowledgeBase: boolean;
  tags: string[];
}
```

**Prompt strategy:** Few-shot com 15-20 exemplos reais de cada intent. JSON mode forcado. Sem chain-of-thought (velocidade e prioritaria).

### 5.3 Vera (Attendant Agent)

**Modelo:** Claude claude-sonnet-4-6 (qualidade de atendimento em portugues)
**Latencia alvo:** < 3s
**Custo medio:** ~$0.01/mensagem

**Responsabilidades:**
- Gerar resposta conversacional baseada no contexto completo
- Usar tool calling para buscar imoveis quando necessario
- Referenciar historico de conversas para continuidade
- Adaptar tom ao perfil do lead (novo vs engajado vs frustrado)
- Responder perguntas sobre financiamento, documentacao, processo de compra

**Tools disponiveis para Vera:**

```typescript
const veraTools = [
  {
    name: 'search_properties',
    description: 'Busca imoveis no catalogo por criterios',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['apartamento', 'casa', ...] },
        neighborhood: { type: 'string' },
        minPrice: { type: 'number' },
        maxPrice: { type: 'number' },
        minBedrooms: { type: 'number' },
        amenities: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'schedule_visit',
    description: 'Agenda visita a um imovel',
    parameters: {
      propertyId: { type: 'string' },
      preferredDate: { type: 'string' },
      preferredTime: { type: 'string' }
    }
  },
  {
    name: 'get_property_details',
    description: 'Obtem detalhes completos de um imovel especifico',
    parameters: {
      propertyId: { type: 'string' }
    }
  }
];
```

**Prompt strategy:** System prompt longo com persona da imobiliaria, regras de atendimento, FAQs injetadas, e historico da conversa. User message e a mensagem atual do cliente.

### 5.4 Cy (Copywriter Agent)

**Modelo:** Claude claude-sonnet-4-6 (mesmo request que Vera, 2-step no mesmo prompt)
**Latencia alvo:** < 500ms
**Custo medio:** ~$0.003/mensagem

**Responsabilidades:**
- Pos-processar a resposta da Vera
- Adaptar para formato WhatsApp (max 4096 chars, use bold, italics, listas)
- Adicionar CTAs contextuais ("Quer agendar uma visita?", "Posso enviar mais opcoes?")
- Humanizar linguagem (remover formalismo excessivo)
- Garantir que nenhuma informacao critica foi perdida no pos-processamento

**Regras de formatacao WhatsApp:**
- `*bold*` para destaques
- `_italic_` para nomes de imoveis
- Emojis com moderacao (max 3 por mensagem)
- Listas numeradas para opcoes de imoveis
- Quebras de linha para legibilidade
- Max 4 paragrafos por mensagem

**Otimizacao de custo:** Em vez de uma LLM call separada, Cy pode ser implementado como um segundo step no prompt da Vera. A instrucao de formatacao e humanizacao fica no system prompt, e a Vera ja retorna a mensagem final formatada. Isso corta 1 LLM call por mensagem.

[AUTO-DECISION] "Cy como LLM call separado vs integrado na Vera?" -> Integrado na Vera por default, separado apenas quando o tenant configura customizacao avancada de copy. Razao: economia de 30-40% em custo de LLM por mensagem, reducao de 500ms de latencia.

### 5.5 Atlas (CEO Agent)

**Modelo:** Sem LLM call para decisoes simples (regras deterministicas). Claude claude-sonnet-4-6 apenas para decisoes ambiguas.
**Latencia alvo:** < 50ms (regras) / < 2s (LLM)
**Custo medio:** ~$0.001/mensagem (maioria e regra, sem LLM)

**Responsabilidades:**
- Decidir se a resposta da IA e enviada ou se escala para humano
- Monitorar metricas em tempo real por tenant (mensagens/min, taxa de erro)
- Bloquear respostas potencialmente problematicas (PII, promessas de preco, juridico)
- Gerenciar rate limiting por tenant (respeitar plano contratado)

**Regras de escalacao (deterministicas):**

```typescript
interface EscalationRules {
  // Escala imediatamente
  immediate: [
    'cliente pediu para falar com humano',
    'negociacao de preco ativa (3+ mensagens sobre valor)',
    'questoes juridicas/contratuais',
    'reclamacao grave (sentiment = frustrated + 2 msgs seguidas)',
  ];

  // Escala se lead score > threshold
  scoreThreshold: {
    visitScheduled: 80,    // lead agendou visita
    priceNegotiation: 70,  // discutindo preco
    documentationPhase: 75, // perguntando sobre documentos
  };

  // Escala se confianca < threshold
  confidenceThreshold: 0.3; // Vera reportou baixa confianca
}
```

**Content filter (pre-envio):**

```typescript
const contentFilters = [
  // Nunca prometer preco exato (responsabilidade juridica)
  { pattern: /garanto.*pre[cç]o|pre[cç]o.*garantido/i, action: 'rewrite' },
  // Nunca compartilhar dados pessoais de proprietarios
  { pattern: /cpf|rg|telefone.*propriet/i, action: 'block' },
  // Nunca fazer afirmacoes sobre valorizacao futura
  { pattern: /vai.*valorizar|investimento.*seguro/i, action: 'rewrite' },
];
```

### 5.6 Leo (Analyst Agent)

**Modelo:** OpenAI GPT-4o (analise de batch, custo-beneficio)
**Execucao:** Cron a cada 6 horas
**Custo medio:** ~$0.50/execucao (analisa batch de conversas)

**Responsabilidades:**
- Analisar todas as conversas do periodo
- Calcular metricas de performance por agente e por tenant
- Identificar padroes de sucesso e falha
- Propor melhorias de prompt (armazena em prompt_suggestions)
- Detectar FAQs novas que devem ser adicionadas a knowledge base
- Gerar relatorio executivo para dashboard

**Metricas calculadas:**

```typescript
interface AnalysisMetrics {
  // Engagement
  totalConversations: number;
  avgMessagesPerConversation: number;
  responseRate: number;           // % de mensagens que geraram resposta do cliente

  // Performance
  avgResponseLatencyMs: number;
  avgTokensPerResponse: number;
  totalCost: number;

  // Conversao
  escalationRate: number;         // % de conversas escaladas
  conversionRate: number;         // % de leads que agendaram visita
  abandonmentRate: number;        // % de conversas abandonadas
  avgAbandonmentPoint: number;    // mensagem N media onde cliente para de responder

  // Qualidade
  topIntents: { intent: string; count: number }[];
  unansweredQuestions: string[];  // perguntas que geraram baixa confianca
  commonObjections: string[];     // objecoes mais frequentes
}
```

---

## 6. Sistema de Memoria

### 6.1 Arquitetura de 3 Camadas

```
+------------------------------------------------------------------+
|                    MEMORY MANAGER (Facade)                        |
|  memory-manager.ts                                               |
|                                                                  |
|  getContext(tenantId, phoneHash) -> MergedContext                |
|  saveMessage(msg) -> void                                       |
|  updatePreferences(contactId, prefs) -> void                    |
+------------------------------------------------------------------+
        |                    |                    |
        v                    v                    v
+----------------+  +------------------+  +------------------+
| SESSION MEMORY |  | LONG-TERM MEMORY |  | SEMANTIC MEMORY  |
| (Redis)        |  | (PostgreSQL)     |  | (pgvector)       |
+----------------+  +------------------+  +------------------+
| TTL: 24h       |  | Retencao: ilimit |  | Embeddings de    |
| Ultimas 10 msg |  | Todas as msgs    |  | preferencias     |
| Lead profile   |  | Lead events      |  | Busca por        |
| cache          |  | Conversations    |  | similaridade     |
| Sessao ativa   |  | Knowledge base   |  | de imoveis       |
| (human/bot)    |  | Analysis reports |  |                  |
+----------------+  +------------------+  +------------------+
     ~1ms read          ~5-20ms read          ~20-50ms read
```

### 6.2 Identificador do Cliente

```typescript
// Cada cliente e identificado por hash(phone + tenantId)
// Isso garante:
// 1. Privacidade: telefone real nunca e chave primaria
// 2. Isolamento multi-tenant: mesmo telefone em tenants diferentes = IDs diferentes
// 3. Consistencia: mesmo telefone sempre gera mesmo hash no mesmo tenant

function generateContactHash(phone: string, tenantId: string): string {
  const normalized = phone.replace(/\D/g, '');  // remove formatacao
  return crypto
    .createHash('sha256')
    .update(`${normalized}:${tenantId}`)
    .digest('hex');
}
```

### 6.3 Session Memory (Redis)

**Estrutura de chaves:**

```
session:{tenant_id}:{phone_hash}           -> JSON (sessao ativa)
session:{tenant_id}:{phone_hash}:messages  -> LIST (ultimas 10 mensagens)
session:{tenant_id}:{phone_hash}:lead      -> JSON (lead profile cache)
dedup:{wa_message_id}                      -> "1" (TTL 5min)
rate:{tenant_id}                           -> counter (TTL 1min)
```

**Session object:**

```typescript
interface SessionData {
  conversationId: string;
  contactId: string;
  status: 'active' | 'human_takeover';
  lastAgentName: string;
  lastIntent: string;
  propertiesShown: string[];    // IDs de imoveis ja mostrados (evita repetir)
  startedAt: string;
  lastMessageAt: string;
}
```

**Politica de TTL:**
- Sessao ativa: 24h (renovada a cada mensagem)
- Lead profile cache: 1h (invalidado em qualquer update)
- Dedup: 5min (Evolution API pode reenviar webhook)
- Rate limit counter: 1min (sliding window)

### 6.4 Long-term Memory (PostgreSQL)

**Historico completo** de todas as conversas e eventos do lead. Usado para:
- Reconstruir sessao quando Redis expira (cliente volta depois de 24h+)
- Alimentar analise do Leo
- Dashboard de metricas
- Auditoria e compliance

**Query de reconstrucao de sessao:**

```sql
-- Quando Redis sessao expirou, reconstruir contexto do PostgreSQL
SELECT m.content, m.sender_type, m.agent_name, m.created_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.contact_id = $1
  AND c.tenant_id = $2
ORDER BY m.created_at DESC
LIMIT 20;  -- ultimas 20 mensagens de qualquer conversa anterior
```

### 6.5 Semantic Memory (pgvector)

Usado para duas funcoes:

**1. Busca de imoveis por similaridade:**
- Cada imovel tem embedding da descricao (text-embedding-3-small, 1536 dims)
- Busca por similaridade de cosseno quando cliente descreve o que quer
- Combinada com filtros estruturados (preco, quartos, bairro)

**2. Busca de FAQs relevantes:**
- Cada FAQ na knowledge_base tem embedding da pergunta
- Quando cliente faz pergunta, busca FAQs similares para injetar no prompt

**Estrategia de embeddings:**

```typescript
// Gerar embedding para imovel (na insercao/atualizacao)
async function generatePropertyEmbedding(property: Property): Promise<number[]> {
  const text = [
    property.type,
    property.title,
    property.description,
    `${property.bedrooms} quartos`,
    `${property.bathrooms} banheiros`,
    property.neighborhood,
    property.city,
    (property.amenities || []).join(', '),
    `R$ ${property.price.toLocaleString()}`
  ].filter(Boolean).join('. ');

  return openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
}
```

---

## 7. Learning Engine

### 7.1 Visao Geral

O Learning Engine e o diferencial competitivo do IMOBX. Em vez de prompts estaticos, o sistema melhora continuamente baseado em dados reais de conversas.

```
+---------------------------------------------------------------+
|                   LEARNING ENGINE (Leo)                        |
|                                                                |
|   TRIGGER: Cron a cada 6h                                     |
|                                                                |
|   +------------------+                                         |
|   | 1. COLETA        |  - Busca conversas do periodo           |
|   |                  |  - Agrupa por tenant                    |
|   +--------+---------+  - Filtra conversas com 3+ mensagens   |
|            |                                                   |
|            v                                                   |
|   +------------------+                                         |
|   | 2. ANALISE       |  - GPT-4o analisa batch                |
|   |                  |  - Detecta padroes                     |
|   +--------+---------+  - Calcula metricas                    |
|            |                                                   |
|            v                                                   |
|   +------------------+                                         |
|   | 3. OTIMIZACAO    |  - Propoe melhorias de prompt          |
|   |                  |  - Sugere FAQs novas                   |
|   +--------+---------+  - Ranking de estrategias              |
|            |                                                   |
|            v                                                   |
|   +------------------+                                         |
|   | 4. APLICACAO     |  - Salva prompt_suggestions            |
|   |                  |  - Atualiza knowledge_base             |
|   +------------------+  - Gera analysis_report                |
|                                                                |
+---------------------------------------------------------------+
```

### 7.2 Pipeline de Analise

**Fase 1 -- Coleta:**

```typescript
async function collectConversations(periodHours: number = 6): Promise<ConversationBatch[]> {
  const cutoff = new Date(Date.now() - periodHours * 3600 * 1000);

  // Busca conversas com 3+ mensagens (ignora "oi" sem resposta)
  const conversations = await db.query(`
    SELECT c.*, t.name as tenant_name,
           array_agg(
             json_build_object(
               'content', m.content,
               'sender_type', m.sender_type,
               'agent_name', m.agent_name,
               'created_at', m.created_at
             ) ORDER BY m.created_at
           ) as messages
    FROM conversations c
    JOIN tenants t ON t.id = c.tenant_id
    JOIN messages m ON m.conversation_id = c.id
    WHERE c.started_at >= $1
      AND c.messages_count >= 3
    GROUP BY c.id, t.name
  `, [cutoff]);

  // Agrupa por tenant para analise contextualizada
  return groupByTenant(conversations);
}
```

**Fase 2 -- Analise (GPT-4o):**

Para cada tenant, batch de conversas e enviado ao GPT-4o com prompt estruturado:

```
Analise as seguintes {N} conversas da imobiliaria "{tenant_name}".
Para cada conversa, identifique:
1. Se o atendimento foi bem-sucedido (cliente engajou, agendou visita, etc.)
2. Se houve ponto de abandono (onde o cliente parou de responder)
3. Objecoes que o cliente levantou
4. Perguntas que a IA nao soube responder bem
5. Oportunidades perdidas (poderia ter sugerido imovel, agendar visita, etc.)

Retorne em JSON com o schema: AnalysisResult
```

**Fase 3 -- Otimizacao:**

```typescript
interface PromptSuggestion {
  agentName: string;
  currentSection: string;   // qual parte do prompt melhorar
  suggestedChange: string;  // mudanca proposta
  reason: string;           // baseado em quais dados
  expectedImpact: 'low' | 'medium' | 'high';
  autoApply: boolean;       // true para baixo risco (FAQ), false para prompts
}
```

**Fase 4 -- Aplicacao:**

- FAQs detectadas: inseridas automaticamente na knowledge_base com `source = 'learned'`
- Melhorias de prompt: salvas em `prompt_suggestions` para revisao humana via dashboard
- Metricas: salvas em `analysis_reports` para historico

### 7.3 Feedback Loop

```
Conversa real -> Metricas -> Analise Leo -> Sugestao de melhoria
                                              |
                                              v
                                     Dashboard (revisao humana)
                                              |
                                              v
                                     prompt_versions (novo prompt)
                                              |
                                              v
                                     Proximas conversas usam prompt melhorado
                                              |
                                              v
                                     Metricas melhoram (ou nao)
                                              |
                                              v
                                     Leo detecta e ajusta novamente
```

---

## 8. Estrategia Multi-Tenancy

### 8.1 Modelo de Isolamento

**Abordagem:** Shared database, tenant_id em todas as tabelas.

**Justificativa:** Para o estagio inicial (1-50 tenants), banco compartilhado com isolamento por `tenant_id` e a opcao mais simples e custo-efetiva. Migracao para banco dedicado por tenant so sera necessaria se um tenant precisar de compliance especifico ou volume extremo.

```
                    +---------------------------+
                    |      PostgreSQL 16         |
                    |                           |
                    |  tenant_id em TODA tabela |
                    |  Indexes incluem tenant_id|
                    |  RLS opcional (futuro)     |
                    +---------------------------+
                         |            |
              +----------+            +----------+
              |                                  |
    Imobiliaria A                     Imobiliaria B
    (tenant_id: aaa)                  (tenant_id: bbb)
    - seus contacts                   - seus contacts
    - seus properties                 - seus properties
    - seus conversations              - seus conversations
    - suas configs IA                 - suas configs IA
```

### 8.2 Isolamento por Camada

| Camada | Estrategia | Implementacao |
|--------|------------|---------------|
| **API** | API key unica por tenant | Hash armazenado em `tenants.api_key_hash` |
| **Webhook** | URL unica por instancia Evolution | Cada tenant tem sua instancia Evolution API |
| **Database** | `tenant_id` FK em todas as tabelas | Queries sempre filtram por tenant_id |
| **Redis** | Prefixo de chave `{tenant_id}:` | Namespacing natural |
| **AI Prompts** | System prompts por tenant | `prompt_versions` versionados por tenant |
| **Rate Limiting** | Limites por tenant (plano) | BullMQ rate limiter + Redis counter |
| **Billing** | Contagem de mensagens por tenant | `tenants.messages_used_this_month` |

### 8.3 Planos e Limites

```typescript
const PLAN_LIMITS = {
  starter: {
    monthlyMessages: 5000,
    maxConcurrentChats: 20,
    maxProperties: 500,
    agents: ['vera', 'cat'],          // sem Atlas avancado, sem Leo
    models: { primary: 'gpt-4o-mini' },
    support: 'email',
  },
  professional: {
    monthlyMessages: 20000,
    maxConcurrentChats: 100,
    maxProperties: 5000,
    agents: ['vera', 'cat', 'cy', 'atlas'],
    models: { primary: 'claude-sonnet-4-6' },
    support: 'priority',
  },
  enterprise: {
    monthlyMessages: -1,              // ilimitado
    maxConcurrentChats: -1,
    maxProperties: -1,
    agents: ['vera', 'cat', 'cy', 'atlas', 'leo'],
    models: { primary: 'claude-sonnet-4-6', analysis: 'gpt-4o' },
    support: 'dedicated',
    customPrompts: true,
    webhookNotifications: true,
  }
} as const;
```

### 8.4 Configuracao da Evolution API por Tenant

Cada tenant precisa de sua propria instancia na Evolution API. O IMOBX gerencia isso automaticamente no onboarding:

```typescript
// evolution_config armazenado em tenants.evolution_config
interface EvolutionConfig {
  instanceName: string;       // "imobx_{tenant_slug}"
  apiUrl: string;             // "http://localhost:8080" (self-hosted)
  apiKey: string;             // chave da instancia Evolution
  webhookUrl: string;         // "https://api.imobx.com/webhook/{tenant_slug}"
  number: string;             // numero WhatsApp conectado
  status: 'disconnected' | 'connecting' | 'connected';
}
```

---

## 9. Consideracoes de Seguranca

### 9.1 Dados Sensiveis

| Dado | Classificacao | Protecao |
|------|---------------|----------|
| Telefone do cliente | PII | Armazenado como hash (SHA256). Display mascarado (***1234). |
| Conteudo das mensagens | PII | Criptografia at-rest (PostgreSQL TDE ou disk encryption). |
| API keys dos tenants | Secret | Armazenadas como bcrypt hash. Nunca logadas. |
| Credenciais Evolution API | Secret | Armazenadas em env vars ou vault, nunca no banco. |
| Chaves OpenAI/Anthropic | Secret | Env vars no PM2 ecosystem. Nunca no codigo. |

### 9.2 Autenticacao e Autorizacao

```
WhatsApp -> Evolution API: assinatura do webhook (HMAC-SHA256)
Evolution -> IMOBX API:    API key do tenant (header X-API-Key)
Admin -> IMOBX API:        JWT com scopes por tenant
Dashboard -> API:          Session-based auth (cookie httpOnly)
```

**Validacao de webhook:**

```typescript
function validateEvolutionSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### 9.3 Rate Limiting

```typescript
// Por tenant (respeitar plano)
const tenantLimiter = {
  starter:      { max: 50,  window: '1m' },  // 50 msgs/min
  professional: { max: 200, window: '1m' },  // 200 msgs/min
  enterprise:   { max: 500, window: '1m' },  // 500 msgs/min
};

// Por IP (protecao contra abuso)
const ipLimiter = { max: 100, window: '1m' };

// Global (protecao contra DDoS)
const globalLimiter = { max: 1000, window: '1m' };
```

### 9.4 Content Safety

**Pre-envio (Atlas content filter):**
- Bloquear respostas com PII de proprietarios
- Bloquear promessas de preco/valorizacao (responsabilidade juridica)
- Detectar tentativas de jailbreak no prompt do usuario
- Limitar tamanho de resposta (max 4096 chars para WhatsApp)

**Jailbreak protection:**

```typescript
const JAILBREAK_PATTERNS = [
  /ignore.*previous.*instructions/i,
  /you.*are.*now/i,
  /pretend.*you.*are/i,
  /system.*prompt/i,
  /reveal.*instructions/i,
];

function detectJailbreak(message: string): boolean {
  return JAILBREAK_PATTERNS.some(p => p.test(message));
}
// Se detectado: responder com mensagem padrao, nao processar pelo pipeline de agentes
```

### 9.5 Auditoria

- Toda mensagem e logada com `agent_name`, `tokens_used`, `latency_ms`
- Toda mudanca em lead_score e registrada em `lead_events`
- Toda escalacao e registrada em `escalations`
- Toda alteracao de prompt e versionada em `prompt_versions`
- Logs estruturados com correlation_id (conversation_id) para rastreabilidade

### 9.6 LGPD Compliance

```typescript
// Direito ao esquecimento
async function deleteContactData(contactId: string, tenantId: string): Promise<void> {
  // CASCADE deleta: conversations -> messages, lead_events
  await db.query('DELETE FROM contacts WHERE id = $1 AND tenant_id = $2', [contactId, tenantId]);
  // Limpar Redis
  await redis.del(`session:${tenantId}:*`); // usar SCAN em producao
  // Log da acao para auditoria
  await db.query(
    'INSERT INTO audit_log (action, entity, entity_id, tenant_id) VALUES ($1, $2, $3, $4)',
    ['data_deletion', 'contact', contactId, tenantId]
  );
}

// Exportacao de dados (portabilidade)
async function exportContactData(contactId: string, tenantId: string): Promise<ContactExport> {
  const contact = await db.query('SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2', [contactId, tenantId]);
  const conversations = await db.query(
    'SELECT c.*, array_agg(m.*) as messages FROM conversations c JOIN messages m ON m.conversation_id = c.id WHERE c.contact_id = $1 AND c.tenant_id = $2 GROUP BY c.id',
    [contactId, tenantId]
  );
  return { contact, conversations };
}
```

---

## 10. Plano de Escalabilidade

### 10.1 Gargalos Previsiveis e Mitigacoes

| Gargalo | Threshold | Mitigacao |
|---------|-----------|-----------|
| **BullMQ worker** | >100 msgs/s | Escalar workers horizontalmente (PM2 cluster mode) |
| **PostgreSQL queries** | >50ms avg | Adicionar read replicas, connection pooling (PgBouncer) |
| **pgvector search** | >100ms p99 | Aumentar `lists` no IVFFlat, considerar HNSW index |
| **Redis memory** | >1GB | Ajustar TTL, mover sessoes inativas para PostgreSQL |
| **LLM API latency** | >5s p99 | Fallback para modelo menor, cache de respostas similares |
| **LLM API cost** | >$X/mes | Implementar cache semantico de respostas |

### 10.2 Fase 1: Single Server (1-20 tenants, ate ~500 msgs/hora)

```
Single VPS (4 vCPU, 8GB RAM):
  - PM2: API (2 instances) + Worker (2 instances) + Leo (1 instance)
  - PostgreSQL 16 local
  - Redis local
  - Evolution API v2 local
  - Nginx reverse proxy
```

**Estimativa de recursos:**
- API + Workers: ~1GB RAM
- PostgreSQL: ~1GB RAM (shared_buffers = 256MB)
- Redis: ~256MB
- Evolution API: ~512MB
- OS + overhead: ~1GB
- Total: ~4GB (confortavel em 8GB VPS)

### 10.3 Fase 2: Separacao de Concerns (20-100 tenants, ate ~5000 msgs/hora)

```
VPS 1 (API + Workers):    8 vCPU, 16GB RAM
VPS 2 (PostgreSQL):       4 vCPU, 16GB RAM (dedicated DB)
VPS 3 (Redis + Evolution): 4 vCPU, 8GB RAM

  - API: PM2 cluster mode (4 instances)
  - Workers: PM2 cluster mode (8 instances)
  - PostgreSQL: PgBouncer (pool de conexoes)
  - Redis: maxmemory 2GB, eviction policy allkeys-lru
```

### 10.4 Fase 3: Horizontal Scaling (100+ tenants, ate ~50000 msgs/hora)

```
Load Balancer (Nginx/HAProxy)
    |
    +-- API Cluster (3+ VPS, auto-scaling)
    |
    +-- Worker Cluster (5+ VPS, auto-scaling por queue depth)
    |
    +-- PostgreSQL Primary + 2 Read Replicas
    |
    +-- Redis Cluster (3 nodes, sharding)
    |
    +-- Evolution API Cluster (1 instance per 50 tenants)
```

**Consideracoes para Fase 3:**
- Migrar para Kubernetes se complexidade justificar
- Considerar managed database (RDS/Cloud SQL)
- Implementar cache semantico de respostas (Redis + embeddings)
- Considerar separacao de tenants grandes em bancos dedicados

### 10.5 Cache Semantico (Otimizacao Avancada)

Para reduzir custo de LLM em escala:

```typescript
// Antes de chamar LLM, verificar se pergunta similar ja foi respondida
async function checkSemanticCache(
  tenantId: string,
  queryEmbedding: number[],
  threshold: number = 0.95
): Promise<CachedResponse | null> {
  const result = await db.query(`
    SELECT response, 1 - (embedding <=> $2) as similarity
    FROM response_cache
    WHERE tenant_id = $1
      AND (1 - (embedding <=> $2)) >= $3
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY embedding <=> $2
    LIMIT 1
  `, [tenantId, queryEmbedding, threshold]);

  return result.rows[0] || null;
}
// Threshold alto (0.95) para evitar respostas incorretas
// TTL de 7 dias para manter respostas atualizadas
```

### 10.6 Monitoramento

**Metricas criticas para alertas:**

```typescript
const ALERT_THRESHOLDS = {
  // Performance
  webhookLatencyP99: 200,          // ms (tempo ate responder 200 ao webhook)
  messageProcessingP99: 8000,      // ms (tempo total ate enviar resposta)
  queueDepth: 500,                 // jobs pendentes

  // Disponibilidade
  workerHealthcheck: 30,           // segundos sem heartbeat
  redisConnectionLost: true,       // evento
  postgresConnectionLost: true,    // evento

  // Negocio
  errorRate: 5,                    // % de mensagens com erro
  escalationRate: 30,              // % (pode indicar problema nos prompts)
  abandonmentRate: 40,             // % (pode indicar problema de qualidade)
  monthlyBudgetUsage: 80,          // % do budget de LLM
};
```

**Stack de observabilidade (Fase 1, simples):**
- Logs estruturados (pino/fastify) com correlation_id
- PM2 metrics (CPU, memory, restarts)
- PostgreSQL: pg_stat_statements (queries lentas)
- Redis: INFO command (memory, connected clients)
- Cron job simples que verifica metricas e envia alerta (WhatsApp/Telegram)

---

## Apendice A: Estrutura de Diretorios Completa

```
/home/takez/IMOBX/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   │   ├── webhook.ts
│   │   │   │   ├── health.ts
│   │   │   │   ├── tenants.ts
│   │   │   │   └── properties.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   └── signature.ts
│   │   │   ├── workers/
│   │   │   │   ├── message-worker.ts
│   │   │   │   ├── orchestrator.ts
│   │   │   │   └── context-builder.ts
│   │   │   ├── plugins/
│   │   │   │   ├── redis.ts
│   │   │   │   ├── postgres.ts
│   │   │   │   └── bullmq.ts
│   │   │   └── types/
│   │   │       ├── webhook.ts
│   │   │       └── tenant.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── agents/
│   │   ├── src/
│   │   │   ├── base-agent.ts
│   │   │   ├── atlas/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── rules.ts
│   │   │   ├── vera/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── tools.ts
│   │   │   ├── cy/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── templates.ts
│   │   │   ├── cat/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── schema.ts
│   │   │   ├── leo/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── cron.ts
│   │   │   └── shared/
│   │   │       ├── types.ts
│   │   │       ├── context.ts
│   │   │       └── response.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── dashboard/                  # Fase posterior
│       └── (Next.js app)
│
├── packages/
│   ├── evolution/
│   │   └── src/
│   │       ├── client.ts
│   │       ├── types.ts
│   │       └── formatter.ts
│   ├── memory/
│   │   └── src/
│   │       ├── session-memory.ts
│   │       ├── long-term-memory.ts
│   │       ├── semantic-memory.ts
│   │       └── memory-manager.ts
│   ├── ai/
│   │   └── src/
│   │       ├── claude.ts
│   │       ├── openai.ts
│   │       ├── prompt-builder.ts
│   │       └── token-counter.ts
│   ├── property-db/
│   │   └── src/
│   │       ├── repository.ts
│   │       ├── search.ts
│   │       ├── embeddings.ts
│   │       └── types.ts
│   └── learning/
│       └── src/
│           ├── analyzer.ts
│           ├── pattern-detector.ts
│           ├── prompt-optimizer.ts
│           └── report-generator.ts
│
├── database/
│   ├── migrations/
│   │   ├── 001_extensions.sql
│   │   ├── 002_tenants.sql
│   │   ├── 003_contacts.sql
│   │   ├── 004_conversations.sql
│   │   ├── 005_messages.sql
│   │   ├── 006_properties.sql
│   │   ├── 007_lead_events.sql
│   │   ├── 008_escalations.sql
│   │   ├── 009_knowledge_base.sql
│   │   ├── 010_prompt_versions.sql
│   │   ├── 011_analysis_reports.sql
│   │   ├── 012_message_dedup.sql
│   │   └── 013_rpc_functions.sql
│   └── seeds/
│       ├── tenant-demo.sql
│       └── properties-demo.sql
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md              # este documento
│   └── API.md
│
├── infra/
│   ├── pm2.config.js
│   └── nginx/
│       └── imobx.conf
│
├── .env.example
├── .gitignore
├── package.json                     # workspace root
├── tsconfig.base.json
└── turbo.json                       # monorepo build orchestration
```

## Apendice B: Configuracao PM2

```javascript
// infra/pm2.config.js
module.exports = {
  apps: [
    {
      name: 'imobx-api',
      script: 'apps/api/dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '500M',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
    },
    {
      name: 'imobx-worker',
      script: 'apps/api/dist/workers/message-worker.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true,
    },
    {
      name: 'imobx-leo',
      script: 'apps/agents/dist/leo/cron.js',
      instances: 1,
      cron_restart: '0 */6 * * *',   // restart a cada 6h (trigger de analise)
      autorestart: false,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/leo-error.log',
      out_file: './logs/leo-out.log',
    },
  ],
};
```

## Apendice C: Variaveis de Ambiente

```bash
# .env.example

# API
PORT=3000
NODE_ENV=production

# PostgreSQL
DATABASE_URL=postgresql://imobx:password@localhost:5432/imobx
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://localhost:6379

# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_GLOBAL_KEY=your-evolution-global-key

# AI - Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# AI - OpenAI
OPENAI_API_KEY=sk-xxx

# Seguranca
WEBHOOK_SECRET=your-webhook-hmac-secret
JWT_SECRET=your-jwt-secret
API_KEY_SALT=your-bcrypt-salt

# Monitoramento
LOG_LEVEL=info
```

## Apendice D: Decisoes Arquiteturais

| ID | Decisao | Alternativa Rejeitada | Razao |
|----|---------|----------------------|-------|
| AD-01 | BullMQ para fila | RabbitMQ, SQS | BullMQ usa Redis existente, sem infra extra. Suficiente para volume previsto. |
| AD-02 | pgvector para busca semantica | Pinecone, Weaviate | Elimina dependencia externa. PostgreSQL ja e necessario. Custo zero. |
| AD-03 | Shared database multi-tenant | Database per tenant | Simples para Fase 1 (1-50 tenants). Migrar se necessario. |
| AD-04 | Cy integrado na Vera | LLM call separada | Economia de 30-40% em custo, reducao de 500ms de latencia. |
| AD-05 | Atlas com regras deterministicas | Sempre usar LLM | 95% das decisoes sao claras (regras). LLM so para ambiguidade. |
| AD-06 | Redis para sessao (TTL 24h) | PostgreSQL para tudo | Latencia de 1ms vs 10ms. Sessao e dados quentes e efemeros. |
| AD-07 | Phone hash como ID do cliente | Telefone em texto plano | Privacidade (LGPD). Mesmo telefone = mesmo hash = consistencia. |
| AD-08 | text-embedding-3-small (1536d) | text-embedding-3-large (3072d) | Custo 5x menor, performance suficiente para busca de imoveis. |
| AD-09 | Fastify sobre Express | Express, Koa | 2x mais rapido, schema validation nativo, melhor DX com TypeScript. |
| AD-10 | Monorepo com workspaces | Repos separados | Compartilhamento de tipos, deploy atomico, refactoring facil. |

---

*Documento gerado por Aria (Architect Agent) -- IMOBX Architecture v1.0.0*
*Qualquer alteracao neste documento deve ser versionada e revisada.*

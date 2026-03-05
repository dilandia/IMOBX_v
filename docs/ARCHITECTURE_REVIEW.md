# IMOBX -- Revisao Arquitetural

**Versao:** 1.0.0
**Data:** 2026-03-05
**Autora:** Aria (Architect Agent)
**Status:** APPROVED WITH ADVISORIES

---

## 1. Resumo Executivo

A arquitetura proposta no `ARCHITECTURE.md` e solida, bem documentada, e adequada para o MVP do IMOBX. O design demonstra maturidade nas escolhas de stack, pipeline de agentes, schema de banco de dados, e estrategia de multi-tenancy. Identifiquei **3 problemas criticos**, **5 melhorias recomendadas**, e **2 riscos de performance** que devem ser tratados antes do go-live.

**Veredicto global:** APROVADO COM CONDICOES

---

## 2. Validacao do Schema de Banco de Dados

### 2.1 Pontos Fortes

1. **Isolamento multi-tenant via `tenant_id` FK em todas as tabelas** -- correto para o estagio atual (1-50 tenants). O PRD mencionava schema-level isolation, mas a arquitetura corretamente escolheu shared database com `tenant_id`, que e mais simples de operar.

2. **Phone hashing (SHA256)** -- boa pratica para LGPD. A composicao `hash(phone + tenantId)` garante que o mesmo telefone em tenants diferentes gera hashes diferentes, mantendo isolamento.

3. **Indices bem desenhados** -- indices parciais (WHERE status = 'active') em properties e knowledge_base reduzem tamanho e melhoram performance.

4. **Tabela `message_dedup`** -- crucial para idempotencia de webhooks. Boa decisao separar do cache Redis (persistencia vs velocidade).

5. **`lead_events` como audit trail** -- permite reconstruir a jornada completa do lead. A funcao RPC `update_lead_score` com auditoria automatica e um padrao solido.

### 2.2 Problemas Identificados

**CRITICO-1: IVFFlat index na tabela `properties` com `lists = 100` e prematuro**

```sql
CREATE INDEX idx_properties_embedding ON properties
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

O IVFFlat requer que a tabela ja tenha dados para calcular os centroides. Com `lists = 100`, a tabela precisa de pelo menos 10.000-100.000 registros para o index ser eficaz. No MVP, cada tenant tera 50-500 imoveis. Com poucos dados, o IVFFlat retorna resultados piores que busca exata (brute force).

**Recomendacao:** Usar HNSW index em vez de IVFFlat. HNSW nao depende de volume de dados para ser eficaz e tem melhor recall em datasets pequenos.

```sql
-- SUBSTITUIR por:
CREATE INDEX idx_properties_embedding ON properties
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

Alternativamente, comecar sem index vetorial (brute force) ate ter >1000 imoveis por tenant, depois criar HNSW.

**CRITICO-2: Falta de `tenant_id` no index de messages**

O index `idx_messages_conversation` nao inclui `tenant_id`:

```sql
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
```

Como `conversations` ja filtra por `tenant_id`, queries via JOIN estao protegidas. Porem, queries diretas na tabela `messages` nao tem como filtrar por tenant sem JOIN, o que pode ser um problema para a analise do Leo (que faz SELECT direto).

**Recomendacao:** Adicionar `tenant_id` denormalizado na tabela `messages` para queries diretas do Leo e para auditoria.

**CRITICO-3: Tabela `message_dedup` sem estrategia de limpeza automatizada**

O comentario diz "TTL via pg_cron" mas nao ha DDL nem configuracao. Em producao com 500 msgs/hora, essa tabela cresce 12.000 rows/dia. Em 6 meses: ~2.2 milhoes de rows desnecessarias.

**Recomendacao:** Implementar pg_cron job ou particionar por mes:

```sql
-- Opcao A: pg_cron (simples)
SELECT cron.schedule('cleanup-dedup', '0 */6 * * *',
  $$DELETE FROM message_dedup WHERE processed_at < NOW() - INTERVAL '48 hours'$$
);

-- Opcao B: Particionamento mensal (escalavel)
-- Criar tabela particionada desde o inicio
```

### 2.3 Melhorias Recomendadas

**MEDIA-1: Campo `content` na tabela `messages` deveria ter limite**

Mensagens WhatsApp tem limite de 4096 chars, mas audios transcritos podem gerar textos maiores. Definir `TEXT` sem CHECK permite bloat.

```sql
-- Adicionar:
CHECK (length(content) <= 10000)  -- margem para transcricoes
```

**MEDIA-2: Falta tabela `visits` (agendamento de visitas)**

O PRD menciona agendamento de visitas (US-V5, FR14) e Vera tem tool `schedule_visit`, mas nao ha tabela no schema. O schedule_visit tool nao tem onde persistir.

```sql
CREATE TABLE visits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id),
    scheduled_date  DATE NOT NULL,
    scheduled_time  TIME NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
    assigned_to     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**MEDIA-3: `conversations.messages_count`, `agent_messages`, `human_messages` sao contadores denormalizados sem trigger**

Esses campos requerem update atomico a cada INSERT na tabela `messages`. Sem trigger ou atualizacao no worker, ficarao desatualizados.

**Recomendacao:** Criar trigger PostgreSQL ou garantir que o worker atualiza esses contadores atomicamente.

---

## 3. Validacao do Fluxo de Agentes

### 3.1 Pipeline Sequencial: Cat -> Vera -> Cy -> Atlas

O pipeline esta correto e otimizado. A sequencia faz sentido:

1. **Cat primeiro** -- categoriza intent e extrai entidades ANTES de Vera precisar responder. Isso permite que Vera receba contexto rico (intent, entities, score).
2. **Vera segundo** -- gera a resposta com contexto completo (historico + categorizacao do Cat).
3. **Cy terceiro** -- pos-processa a resposta para WhatsApp (formatacao, CTAs).
4. **Atlas ultimo** -- decide se envia ou escala. Funciona como quality gate final.

A decisao de integrar Cy no prompt da Vera (AUTO-DECISION documentada) e excelente. Economia de 30-40% em custo de LLM e reducao de 500ms de latencia. Recomendo manter Cy como modulo separado no codigo mas integrado na LLM call por default.

### 3.2 Timeline de Execucao

A estimativa de 2-5 segundos total e realista:

| Etapa | Tempo estimado | Avaliacao |
|-------|---------------|-----------|
| Webhook -> Queue | ~15ms | OK |
| Context Builder (Redis + PG + pgvector) | ~100ms | OK, mas pgvector pode ser 50ms+ |
| Cat (GPT-4o, classificacao) | ~400ms | Otimista. GPT-4o typical: 500-800ms |
| Vera (Claude Sonnet, resposta) | ~2000ms | Realista para resposta curta |
| Cy (integrado na Vera) | 0ms extra | OK se integrado |
| Atlas (regras deterministicas) | ~30ms | OK |
| Envio resposta | ~50ms | OK |
| **Total** | **~2.6s** | **Viavel para P50** |

**Risco:** O P95 pode exceder 5s em cenarios com tool calling (busca de imoveis). Quando Vera faz `search_properties`, a LLM call inclui:
1. Primeira chamada LLM -> decide usar tool -> ~1s
2. Execucao do tool (embedding + pgvector) -> ~200ms
3. Segunda chamada LLM com resultados -> ~2s
4. Total com tool: ~3.2s + Cat 500ms + overhead = **~4s P50, ~6s P95**

**Recomendacao para manter <5s P95:**
- Pre-computar a busca de imoveis no Context Builder quando Cat detecta `intent: property_search`
- Injetar resultados diretamente no contexto da Vera (sem tool calling)
- Usar tool calling apenas para acoes (agendar visita, detalhes de imovel especifico)

### 3.3 Fluxo de Escalacao

O sistema de escalacao (Atlas) esta bem desenhado:

- Regras deterministicas (sem LLM) para decisoes claras -- correto
- LLM apenas para decisoes ambiguas -- correto
- Content filter pre-envio com patterns regex -- bom, mas fragil

**Risco com content filter regex:** Patterns como `/garanto.*pre[cç]o/i` sao faceis de contornar ("te dou minha palavra sobre o preco"). Considerar usar classificacao LLM com confidence threshold para content safety em vez de regex puro.

### 3.4 Observacao sobre Vera como Gargalo Central

Vera e o unico agente que faz LLM call obrigatoria em toda mensagem. Se a API da Anthropic tiver outage:
- Cat pode continuar (OpenAI separada)
- Cy e Atlas nao dependem de LLM
- Mas Vera para tudo

**Recomendacao:** Implementar fallback de modelo na Vera:
1. Primario: Claude Sonnet
2. Fallback: GPT-4o (qualidade boa em portugues)
3. Emergencia: respostas template baseadas em intent do Cat

---

## 4. Validacao do Multi-Tenancy

### 4.1 Modelo de Isolamento: APROVADO

A abordagem de shared database com `tenant_id` e correta para 1-50 tenants. Os pontos de isolamento estao bem mapeados na secao 8.2 da arquitetura:

| Camada | Implementacao | Avaliacao |
|--------|---------------|-----------|
| API | API key por tenant | OK |
| Database | tenant_id FK | OK |
| Redis | Prefixo de chave | OK |
| AI Prompts | prompt_versions versionados | OK |
| Rate Limiting | Por plano | OK |
| Evolution API | Instancia por tenant | OK |

### 4.2 Risco de Seguranca: Falta RLS

O isolamento depende 100% da camada de aplicacao (`WHERE tenant_id = ?`). Se um bug na aplicacao omitir o filtro, dados de todos os tenants ficam expostos.

**Recomendacao ALTA:** Implementar Row-Level Security (RLS) no PostgreSQL como segunda camada de defesa:

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Isso requer que cada request defina `SET app.tenant_id = '{id}'` antes de queries. E uma camada adicional de seguranca que impede vazamento mesmo com bugs na aplicacao.

**Nota:** RLS pode adicionar overhead de ~1-2ms por query. Em MVP com <50 tenants, o trade-off e aceitavel.

### 4.3 Planos e Limites: BEM DESENHADOS

A diferenciacao de planos (starter/professional/enterprise) com modelos de IA diferentes e inteligente:
- Starter com `gpt-4o-mini` reduz custo significativamente
- Enterprise com Leo (learning engine) como diferencial premium

**Sugestao:** O plano starter deveria ter um trial de 7-14 dias com Claude Sonnet (plano professional) para que o cliente veja a diferenca de qualidade e faca upgrade.

---

## 5. Validacao de Performance (<5s)

### 5.1 Cenarios de Performance

| Cenario | Estimativa | Risco |
|---------|-----------|-------|
| Mensagem simples (saudacao) | ~2.5s | BAIXO |
| Mensagem com busca de imoveis | ~4-6s | MEDIO |
| Mensagem com busca + imagens | ~5-8s | ALTO |
| Mensagem de audio (STT + AI) | ~6-10s | ALTO |
| Lead retornando (sessao expirada, rebuild) | ~3-4s | MEDIO |

### 5.2 Gargalos Identificados

1. **Tool calling duplo na Vera** -- cada tool call adiciona ~1s de overhead LLM. Se Vera precisa buscar imoveis E agendar visita na mesma mensagem, sao 2 round-trips extras.

2. **Envio de imagens WhatsApp** -- enviar 3 fotos de imoveis via Evolution API adiciona ~500ms-2s dependendo do tamanho. Isso e paralelo ao processamento mas impacta o tempo total ate o lead ver tudo.

3. **Context Builder com pgvector** -- quando o lead tem preferencias, o Context Builder faz busca semantica proativa. Isso e bom, mas adiciona 50-100ms ao pipeline.

### 5.3 Otimizacoes para Garantir <5s P95

1. **Paralelizar Context Builder:** Redis, PostgreSQL, e pgvector podem ser consultados em paralelo (Promise.all). A arquitetura mostra sequencial (T+60ms, T+80ms, T+100ms) mas devem ser paralelos.

2. **Streaming da resposta da Vera:** Em vez de esperar a resposta completa da LLM, usar streaming para comecar a formatar (Cy) assim que os primeiros tokens chegam. Isso pode economizar ~500ms.

3. **Cache de lead profile:** O Redis cache de 1h para lead profile e adequado. Considerar aumentar para 6h para leads ativos (renovado a cada mensagem).

4. **Connection pooling:** O PG pool com max 20 conexoes por worker e adequado. Com 2 workers em cluster mode, sao 40 conexoes totais. PostgreSQL default maxconnections = 100, entao sobra margem.

---

## 6. Gap Analysis: Arquitetura vs Implementacao Atual

O codigo implementado ate agora (3 arquivos em `apps/api/src/`) cobre apenas o bootstrap:

| Componente Arquitetural | Status |
|------------------------|--------|
| Fastify server + health check | IMPLEMENTADO |
| Webhook receiver basico | IMPLEMENTADO (sem validacao real) |
| QR code endpoint | IMPLEMENTADO (fora da arquitetura) |
| Auth middleware (API key) | NAO IMPLEMENTADO |
| Rate limiting | NAO IMPLEMENTADO |
| Signature validation | PARCIAL (stub) |
| BullMQ queue | NAO IMPLEMENTADO (dep instalada) |
| Message worker | NAO IMPLEMENTADO |
| Context builder | NAO IMPLEMENTADO |
| Agentes (todos) | NAO IMPLEMENTADO |
| PostgreSQL schema | NAO IMPLEMENTADO |
| Redis session | NAO IMPLEMENTADO |
| Memory package | NAO IMPLEMENTADO |
| AI package | NAO IMPLEMENTADO |
| Evolution client | NAO IMPLEMENTADO |

**Nota:** O QR code endpoint e o HTML de conexao WhatsApp nao constam na arquitetura mas sao uteis para onboarding. Recomendo documentar como parte do fluxo de setup do tenant.

---

## 7. Decisoes Arquiteturais Validadas

| Decisao | Avaliacao | Comentario |
|---------|-----------|------------|
| Monolito modular (Fastify) | APROVADO | Correto para MVP. Facil de extrair para microservicos depois. |
| BullMQ para fila | APROVADO | Melhor que Bull (versao nova), retry nativo, rate limiting. |
| Claude Sonnet para Vera | APROVADO | Melhor qualidade em portugues. Custo ~$0.01/msg e aceitavel. |
| GPT-4o para Cat | APROVADO | JSON mode + classificacao rapida. Custo minimo (~$0.002/msg). |
| pgvector para busca semantica | APROVADO | Evita infra extra (Pinecone, Weaviate). Suficiente para MVP. |
| Redis para sessao | APROVADO | TTL 24h correto. Rebuild de PostgreSQL como fallback e bom. |
| PM2 para process management | APROVADO | Cluster mode, restart automatico. Adequado ate 100 tenants. |
| Pino para logging | APROVADO | Structured logging, performant. Integra nativamente com Fastify. |

---

## 8. Conclusao

A arquitetura do IMOBX e madura e bem pensada. As principais acoes antes de comecar a implementacao da Fase 1 sao:

1. **CRITICO:** Trocar IVFFlat por HNSW no index vetorial
2. **CRITICO:** Implementar limpeza automatica de `message_dedup`
3. **CRITICO:** Adicionar tabela `visits` ao schema
4. **ALTA:** Considerar RLS para multi-tenancy defense-in-depth
5. **MEDIA:** Paralelizar Context Builder (Promise.all)
6. **MEDIA:** Pre-computar busca de imoveis quando Cat detecta intent de busca

Com essas correcoes, a arquitetura esta pronta para implementacao.

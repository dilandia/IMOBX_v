# IMOBX -- Risk Analysis

**Versao:** 1.0.0
**Data:** 2026-03-05
**Autora:** Aria (Architect Agent)
**Status:** Active

---

## 1. Resumo de Riscos

| ID | Risco | Severidade | Probabilidade | Prioridade |
|----|-------|-----------|---------------|------------|
| R1 | Latencia de IA excede 5s | ALTA | MEDIA | P0 |
| R2 | Custo de tokens excede target | MEDIA | MEDIA | P1 |
| R3 | Escalabilidade PostgreSQL | MEDIA | BAIXA | P2 |
| R4 | Escalabilidade Redis | BAIXA | BAIXA | P3 |
| R5 | Falha de LLM API (outage) | ALTA | MEDIA | P0 |
| R6 | Evolution API instabilidade | ALTA | MEDIA | P0 |
| R7 | Banimento de numero WhatsApp | CRITICA | MEDIA | P0 |
| R8 | Vazamento de dados multi-tenant | CRITICA | BAIXA | P0 |
| R9 | Degradacao de qualidade de resposta | MEDIA | ALTA | P1 |
| R10 | Recovery de falha (dados inconsistentes) | ALTA | BAIXA | P1 |

---

## 2. Analise Detalhada

### R1: Latencia de IA Excede 5s (P95)

**Descricao:** O NFR1 do PRD define latencia P95 < 5s. O pipeline completo (Cat + Vera + Atlas) tem estimativa de 2.5-4s no happy path, mas cenarios com tool calling (busca de imoveis) ou APIs lentas podem ultrapassar 5s facilmente.

**Cenarios de risco:**
- Vera faz tool call para buscar imoveis: adiciona ~1-2s (LLM round-trip + pgvector)
- API da Anthropic com latencia elevada (picos de carga): P99 pode chegar a 8-10s
- Context Builder com pgvector slow query (embedding search > 100ms)
- Multiplas tool calls na mesma mensagem (busca + agenda visita)
- Lead com historico extenso (20+ mensagens na sessao, contexto grande)

**Impacto:** Lead percebe lentidao, conversa perde naturalidade. Leads acostumados com WhatsApp esperam resposta em 1-3s.

**Mitigacoes:**

| Mitigacao | Efeito | Esforco |
|-----------|--------|---------|
| Pre-computar busca de imoveis no Context Builder quando Cat detecta intent de busca | Elimina 1 tool call (~1-2s) | 2-3 dias |
| Streaming de resposta da Vera (enviar quando primeiros tokens chegam) | Reducao percebida de ~500ms | 3-5 dias |
| Fallback para modelo mais rapido (Claude Haiku) quando latencia > 3s | Garante <5s com qualidade menor | 1-2 dias |
| Cache de respostas para perguntas frequentes (knowledge_base hit) | Elimina LLM call completamente | 2-3 dias |
| Paralelizar Context Builder (Redis + PG + pgvector em Promise.all) | Reducao de ~50-80ms | 1 dia |
| Timeout global de 8s no pipeline com fallback para resposta template | Garante que lead sempre recebe resposta | 1 dia |

**Plano de contingencia:**
Se latencia consistentemente > 5s:
1. Implementar "indicador de digitacao" via Evolution API (Vera "esta digitando...") enquanto processa
2. Enviar mensagem parcial ("Estou buscando opcoes para voce, um momento...") se pipeline > 4s
3. Migrar Cat para GPT-4o-mini (reducao de ~200ms)

**Indicador de digitacao -- detalhe tecnico:**
A Evolution API suporta envio de "presence: composing" que mostra ao lead que alguem esta digitando. Enviar isso IMEDIATAMENTE apos receber a mensagem (antes de processar) da feedback visual ao lead.

---

### R2: Custo de Tokens Excede Target

**Descricao:** PRD define target de R$ 2.00 por conversa completa (lead-to-handoff). Estimativa atual: ~R$ 0.60/conversa (10 mensagens). Margem confortavel, mas pode degradar com:

**Cenarios de risco:**
- Conversas longas (20+ mensagens) -- dobra o custo
- Tool calling intensivo (cada round-trip e ~2x tokens de uma resposta normal)
- Context window grande (lead com historico de 5+ conversas anteriores)
- Leo analytics processando batches grandes (50+ conversas/execucao)
- Modelo upgrade (Anthropic lanca Sonnet 4 com precos diferentes)

**Estimativa detalhada de custo mensal:**

| Cenario | Conversas/mes | Custo/conversa | Total mensal |
|---------|--------------|---------------|-------------|
| 1 tenant, 100 leads | 100 | R$ 0.60 | R$ 60 |
| 10 tenants, 400 leads cada | 4.000 | R$ 0.60 | R$ 2.400 |
| 50 tenants, 400 leads cada | 20.000 | R$ 0.60 | R$ 12.000 |
| Leo analytics (4x/dia) | 120 execucoes | R$ 2.50 | R$ 300 |

**Mitigacoes:**

| Mitigacao | Economia estimada | Esforco |
|-----------|------------------|---------|
| Integrar Cy na Vera (ja decidido) | -30-40% por mensagem | FEITO |
| Cat com GPT-4o-mini em vez de GPT-4o para plano starter | -60% no custo do Cat | 1 dia |
| Cache semantico de respostas (threshold 0.95) | -15-20% para perguntas repetitivas | 3-5 dias |
| Resumir historico longo em vez de enviar todas as mensagens ao LLM | -20% em conversas longas | 2-3 dias |
| Limitar session history a 10 mensagens (ja na arquitetura) | Previne crescimento ilimitado | FEITO |
| Atlas sem LLM para 90%+ das decisoes (ja na arquitetura) | Economiza ~$0.01/msg | FEITO |

**Alertas de custo:**
- Monitorar `messages.tokens_used` por tenant
- Alertar quando custo mensal > 80% do budget estimado para o plano
- Dashboard mostra custo real vs target por conversa

---

### R3: Escalabilidade PostgreSQL

**Descricao:** PostgreSQL e o componente mais critico (dados de negocio, conversas, imoveis, embeddings). Gargalos podem aparecer em:

**Cenarios de risco:**
- Tabela `messages` crescendo rapidamente (500 msgs/hora = ~360.000/mes)
- Busca pgvector em tabela `properties` com muitos registros por tenant
- Query do Leo (JOIN messages + conversations, aggregation) em horario de pico
- Connection pool esgotado (max 20 por worker x 2 workers = 40 conexoes)

**Projecao de crescimento:**

| Tabela | Rows/mes (10 tenants) | Rows/ano | Tamanho estimado |
|--------|----------------------|----------|-----------------|
| messages | 360.000 | 4.3M | ~2GB |
| conversations | 12.000 | 144.000 | ~100MB |
| contacts | 4.000 | 48.000 | ~50MB |
| lead_events | 40.000 | 480.000 | ~200MB |
| properties | 5.000 | 5.000 (estavel) | ~50MB + embeddings |
| message_dedup | 360.000 (com limpeza) | ~720.000 max | ~50MB |

**Mitigacoes:**

| Mitigacao | Quando | Esforco |
|-----------|--------|---------|
| Particionamento de `messages` por mes (range partition em created_at) | Antes de 1M rows | 2-3 dias |
| Read replica para queries do Leo (analytics) | Quando avg query > 50ms | 1 dia (se managed DB) |
| PgBouncer para connection pooling | Quando tenants > 20 | 1 dia |
| Archival de conversas antigas (> 6 meses) para cold storage | Quando storage > 10GB | 2-3 dias |
| VACUUM/ANALYZE automatico (autovacuum tuning) | Desde o inicio | 1 hora |
| Indexes parciais ja desenhados (WHERE status = 'active') | FEITO | -- |

**Plano de contingencia:**
Se PostgreSQL single instance nao aguenta:
1. Migrar para managed database (Supabase, RDS, Cloud SQL)
2. Implementar read replicas para Leo e Dashboard
3. Considerar Citus para sharding horizontal por tenant_id

---

### R4: Escalabilidade Redis

**Descricao:** Redis e usado para sessoes ativas, dedup cache, rate limiting, e lead profile cache.

**Cenarios de risco:**
- Memory crescendo com muitas sessoes ativas (500 conversas simultaneas)
- Eviction policy removendo sessoes importantes
- Conexao perdida durante pico (single point of failure)

**Estimativa de memoria:**

| Dado | Por sessao | 500 sessoes | 5000 sessoes |
|------|-----------|-------------|-------------|
| Session data | ~2KB | ~1MB | ~10MB |
| 10 mensagens/sessao | ~20KB | ~10MB | ~100MB |
| Lead profile cache | ~1KB | ~0.5MB | ~5MB |
| Dedup cache (TTL 5min) | ~100B | ~50KB | ~500KB |
| Rate limit counters | ~100B | ~50KB | ~500KB |
| **Total** | | **~12MB** | **~116MB** |

**Avaliacao:** Risco BAIXO. Mesmo com 5000 sessoes simultaneas, Redis usa ~116MB. VPS com 256MB dedicados ao Redis e suficiente para muito alem do MVP.

**Mitigacoes:**
- maxmemory-policy: allkeys-lru (sessoes inativas sao evicted primeiro)
- Redis persistence: RDB snapshots a cada 5min (protege contra crash)
- Se Redis cair: rebuild de sessao a partir do PostgreSQL (ja previsto na arquitetura)

---

### R5: Falha de LLM API (Outage)

**Descricao:** Se a API da Anthropic (Vera) ou OpenAI (Cat) ficar indisponivel, o pipeline inteiro para.

**Historico de outages (estimativa):**
- Anthropic: ~2-4 outages/mes, duracao tipica 10-30min
- OpenAI: ~1-2 outages/mes, duracao tipica 5-20min

**Impacto:** Leads enviam mensagem e nao recebem resposta. Para um sistema 24/7, isso e critico.

**Mitigacoes -- Estrategia de Fallback em Cascata:**

```
Nivel 1: Retry com backoff exponencial (3 tentativas)
   |
   | falhou
   v
Nivel 2: Modelo alternativo
   - Vera: Claude Sonnet -> GPT-4o -> Claude Haiku
   - Cat: GPT-4o -> GPT-4o-mini -> classificacao local (regex/rules)
   |
   | falhou
   v
Nivel 3: Resposta template baseada em intent
   - greeting -> "Ola! Obrigada pelo contato. Nosso consultor..."
   - property_search -> "Entendi que voce busca imoveis. Vou..."
   - unknown -> "Recebi sua mensagem. Nosso consultor vai..."
   |
   | persistiu > 5 min
   v
Nivel 4: Escalacao automatica para corretor humano
   - Notifica gerente: "Sistema de IA indisponivel"
   - Mensagens enfileiradas em BullMQ para retry posterior
```

**Implementacao:**

```typescript
interface LLMFallbackConfig {
  primary: { provider: 'anthropic'; model: 'claude-sonnet-4-6' };
  secondary: { provider: 'openai'; model: 'gpt-4o' };
  tertiary: { provider: 'anthropic'; model: 'claude-3-5-haiku-20241022' };
  template: { responses: Record<string, string> };
  escalation: { afterMinutes: 5; notifyChannel: 'whatsapp' };
}
```

**Circuit breaker:**
- Abrir circuito apos 5 falhas consecutivas em 1 minuto
- Testar a cada 30s se API voltou (half-open state)
- Fechar circuito apos 3 respostas bem-sucedidas

---

### R6: Evolution API Instabilidade

**Descricao:** Evolution API e self-hosted e e o unico ponto de integracao com WhatsApp. Se cair, nenhuma mensagem e recebida ou enviada.

**Cenarios de risco:**
- Evolution API crash (Node.js memory leak, OOM)
- WhatsApp desconecta a sessao (requer re-scan de QR code)
- Atualizacao do WhatsApp Web quebra Evolution API
- Limite de mensagens atingido (Meta Business)

**Mitigacoes:**

| Mitigacao | Descricao | Esforco |
|-----------|-----------|---------|
| Health check a cada 30s | Endpoint `/instance/status/{name}` monitora conexao | 1 dia |
| PM2 auto-restart | Restart automatico em crash, max 3 restarts em 5min | FEITO |
| Alerta de desconexao | Se status != 'connected', notificar admin imediatamente | 1 dia |
| QR code re-auth automatizado | Quando desconecta, gerar novo QR e notificar admin | 2 dias |
| Message queue como buffer | BullMQ armazena mensagens de saida ate Evolution voltar | FEITO |
| Abstraction layer | Interface `IWhatsAppProvider` permite trocar Evolution por Baileys | 3-5 dias |

**Plano de contingencia para outage prolongado (>1h):**
1. Mensagens de entrada ficam perdidas (WhatsApp nao re-envia)
2. Mensagens de saida ficam na fila BullMQ (retry automatico)
3. Alerta ao admin com instrucoes de recuperacao
4. Considerar segunda instancia Evolution API como hot-standby

---

### R7: Banimento de Numero WhatsApp

**Descricao:** Meta pode banir o numero WhatsApp por spam ou violacao de politicas. Para uma imobiliaria, perder o numero e critico.

**Causas mais comuns:**
- Volume alto de mensagens em numero novo (sem warm-up)
- Leads reportando como spam (mensagens nao solicitadas)
- Conteudo repetitivo (mesma mensagem para muitos contatos)
- Envio em massa sem opt-in

**Mitigacoes:**

| Mitigacao | Descricao |
|-----------|-----------|
| Warm-up gradual | Semana 1: max 50 msgs/dia. Semana 2: 100. Semana 3: 200. Semana 4: normal |
| Opt-out imediato | Se lead diz "para", "nao quero", "spam" -> silencia IMEDIATAMENTE |
| Rate limiting rigoroso | Max 1 mensagem a cada 3 segundos por numero |
| Variacao de mensagens | Cy nunca envia mensagem identica a 2 leads diferentes |
| Monitoramento de quality score | Meta Business API mostra quality rating -- alertar se cair |
| Numero backup | Manter segundo numero WhatsApp configurado para failover |
| Documentacao de opt-in | Registrar quando/como o lead iniciou contato (prova para Meta) |

**Plano de contingencia se banido:**
1. Ativar numero backup (pre-configurado na Evolution API)
2. Re-warmup do novo numero (seguir plano gradual)
3. Notificar todos os leads ativos que numero mudou
4. Investigar causa do banimento e corrigir antes de reativar

---

### R8: Vazamento de Dados Multi-Tenant

**Descricao:** Um bug na aplicacao que omita `WHERE tenant_id = ?` expoe dados de todos os tenants.

**Probabilidade:** Baixa (se praticas de codigo estiverem corretas)
**Impacto:** CRITICO (violacao de LGPD, perda de confianca, possivel acao legal)

**Cenarios de risco:**
- Query sem filtro de tenant_id (desenvolvedor esquece)
- Endpoint admin sem verificacao de tenant
- Log com dados de tenant errado
- Cache Redis com chave sem prefixo de tenant

**Mitigacoes:**

| Mitigacao | Descricao | Esforco |
|-----------|-----------|---------|
| RLS no PostgreSQL | Row-Level Security como 2a camada | 2-3 dias |
| Middleware de tenant injection | Toda request automaticamente seta tenant_id | 1 dia |
| Repository pattern com tenant obrigatorio | Toda query passa por repository que forca tenant_id | 2-3 dias |
| Code review checklist | Verificar tenant_id em toda query nova | Continuo |
| Teste de isolamento automatizado | Testar que tenant A nao ve dados do tenant B | 1-2 dias |
| Audit log de acesso cross-tenant | Logar se uma query retorna dados de multiplos tenants | 1 dia |

**Recomendacao CRITICA:** Implementar RLS desde o inicio. O overhead e minimo (~1-2ms/query) e a protecao e absoluta -- mesmo com bugs na aplicacao, PostgreSQL bloqueia acesso cross-tenant.

---

### R9: Degradacao de Qualidade de Resposta

**Descricao:** A qualidade das respostas da Vera pode degradar com o tempo por varias razoes.

**Cenarios de risco:**
- Anthropic muda comportamento do modelo em update
- Prompts ficam desatualizados com mudancas de mercado
- FAQs da knowledge_base ficam incorretas
- Lead scoring descalibrado gera escalacoes incorretas
- Conversas muito longas perdem coerencia

**Mitigacoes:**

| Mitigacao | Descricao |
|-----------|-----------|
| Prompt versioning | Todo prompt versionado em `prompt_versions`, rollback facil |
| Leo analytics | Deteccao automatica de queda em metricas de engagement |
| Feedback loop | Corretor reporta qualidade do handoff (contexto adequado?) |
| Benchmark semanal | Testar 10 conversas mock por semana contra criterios de qualidade |
| Temperature lock | Fixar temperature em 0.7 para Vera (consistencia) |
| Modelo fixo | Pinnar versao do modelo (ex: `claude-sonnet-4-6-20250514`) para evitar surpresas em updates |

---

### R10: Recovery em Caso de Falha (Dados Inconsistentes)

**Descricao:** Se o worker crashar no meio do pipeline, dados podem ficar inconsistentes.

**Cenarios de risco:**
- Worker crash apos Cat atualizar score mas antes de Vera responder
- Worker crash apos Vera gerar resposta mas antes de salvar no PostgreSQL
- Redis atualizado mas PostgreSQL nao (ou vice-versa)
- BullMQ retry processa mensagem duplicada apesar do dedup

**Mitigacoes:**

| Mitigacao | Descricao | Esforco |
|-----------|-----------|---------|
| BullMQ retry automatico | Job falho e re-processado (3 tentativas) | FEITO (config na arquitetura) |
| Dedup em todas as camadas | message_dedup (PG) + dedup cache (Redis) | FEITO |
| Transacao PG para writes | UPDATE score + INSERT message + INSERT event em uma transacao | 2-3 dias |
| Idempotent operations | Toda operacao pode ser executada 2x sem efeito colateral | Continuo |
| Dead letter queue | Mensagens que falharam 3x vao para DLQ para investigacao manual | 1 dia |
| Health monitor | Alerta se DLQ > 10 jobs ou queue depth > 100 | 1 dia |

**Estrategia de recovery:**

```
Worker crash no meio do pipeline:
  |
  v
BullMQ detecta job nao completado (timeout)
  |
  v
Job e re-enfileirado (retry #1)
  |
  v
Worker pega o job novamente
  |
  v
Dedup check: mensagem ja foi processada?
  - Redis dedup: SIM -> skip (resposta ja foi enviada ao lead)
  - Redis dedup: NAO -> processar normalmente
  |
  v
Se score ja foi atualizado (partial write):
  - update_lead_score com p_delta = 0 -> noop (idempotent)
  - Ou: verificar lead_events para detectar update duplicado
```

**Backup e disaster recovery:**
- pg_dump diario automatico (cron 3:00 AM, retencao 30 dias)
- Redis RDB snapshot a cada 5min
- Armazenamento offsite (S3/B2 bucket) para backups

---

## 3. Matriz de Priorizacao

```
                    IMPACTO
           Baixo    Medio    Alto     Critico
    ┌─────────────────────────────────────────┐
A   │         │  R2,R9  │  R1,R5  │  R7,R8  │
L   │         │         │  R6     │         │
T   ├─────────┼─────────┼─────────┼─────────┤
A   │         │         │  R10    │         │
    │         │         │         │         │
B   │  R4     │  R3     │         │         │
A   │         │         │         │         │
I   ├─────────┼─────────┼─────────┼─────────┤
X   │         │         │         │         │
A   │         │         │         │         │
    └─────────────────────────────────────────┘
          PROBABILIDADE -->
```

**Acoes imediatas (pre-go-live):**
1. R1: Implementar indicador de digitacao + timeout com fallback
2. R5: Implementar cascata de fallback de modelo
3. R6: Health check de Evolution API + alerta de desconexao
4. R7: Plano de warm-up documentado + rate limiting rigoroso
5. R8: Implementar RLS no PostgreSQL

**Acoes pre-escala (antes de 10+ tenants):**
6. R2: Monitoramento de custo por tenant + alertas
7. R3: Particionamento de messages + autovacuum tuning
8. R9: Prompt versioning + benchmark semanal
9. R10: Transacoes atomicas + DLQ monitoring

---

## 4. Checklist de Mitigacao

### Pre-MVP (Obrigatorio)
- [ ] Timeout global de 8s no pipeline com resposta template como fallback
- [ ] "Presence: composing" enviado imediatamente apos receber mensagem
- [ ] BullMQ retry configurado (3 tentativas, backoff exponencial)
- [ ] Dedup em Redis (5min TTL) + message_dedup table
- [ ] Health check endpoint para PostgreSQL, Redis, e Evolution API
- [ ] Rate limiting por tenant implementado
- [ ] Warm-up plan documentado para cada novo numero WhatsApp
- [ ] pg_dump diario automatico configurado
- [ ] Env vars para todas as credenciais (nunca no codigo)

### Pre-Escala (Antes de 10 tenants)
- [ ] RLS no PostgreSQL para todas as tabelas com tenant_id
- [ ] Cascata de fallback de modelo (Claude -> GPT-4o -> templates)
- [ ] Monitoramento de custo por tenant com alertas
- [ ] Particionamento de tabela messages por mes
- [ ] PgBouncer para connection pooling
- [ ] Alerta automatico se Evolution API desconectar
- [ ] Circuit breaker para APIs externas (Anthropic, OpenAI)
- [ ] Teste automatizado de isolamento multi-tenant

### Pre-Producao Estavel (Antes de 50 tenants)
- [ ] Read replica de PostgreSQL para Leo e Dashboard
- [ ] Cache semantico de respostas implementado
- [ ] A/B testing de prompts funcional
- [ ] Backup offsite (S3/B2) configurado
- [ ] Prompt versioning com rollback automatico
- [ ] Benchmark semanal automatizado de qualidade
- [ ] Dead letter queue com alerta e revisao manual

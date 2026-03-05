# IMOBX -- Implementation Roadmap (Fases 2-5)

**Versao:** 1.0.0
**Data:** 2026-03-05
**Autora:** Aria (Architect Agent)
**Pre-requisito:** Fase 1 (Vera Agent + WhatsApp Pipeline) completa e estavel

---

## Visao Geral das Fases

```
Fase 1: Vera (Attendant)          [ATUAL - Em progresso]
  |
  v
Fase 2: Cat (Categorizer/Scoring) [~2-3 semanas]
  |
  v
Fase 3: Cy (Copywriter)           [~1-2 semanas]
  |
  v
Fase 4: Atlas (Orchestrator)       [~2-3 semanas]
  |
  v
Fase 5: Leo (Learning/Analytics)   [~3-4 semanas]
```

**Estimativa total Fases 2-5:** 8-12 semanas
**Dependencia critica:** Fase 1 DEVE estar funcional (Vera respondendo via WhatsApp com memoria Redis basica) antes de iniciar Fase 2.

---

## Fase 2: Cat Agent (Categorizacao e Scoring)

### Objetivo
Adicionar inteligencia de classificacao ao pipeline. Cada mensagem recebida passa pelo Cat antes da Vera, enriquecendo o contexto com intent, entidades, sentiment, e lead score.

### Escopo Tecnico

**2.1 Implementar Cat Agent Core**

Arquivo: `apps/agents/src/cat/agent.ts`

Responsabilidades:
- Classificacao de intent (greeting, property_search, price_question, visit_request, complaint, financing, documentation, general)
- Extracao de entidades (tipo imovel, bairro, faixa de preco, quartos, amenities, urgencia)
- Analise de sentiment (positive, neutral, negative, frustrated)
- Calculo de lead score delta (+5 interesse, +10 visita, +20 negociacao)
- Deteccao de intencao (compra vs aluguel vs investimento)
- Classificacao de estagio do funil (new -> engaged -> interested -> qualified -> visiting -> negotiating)

Modelo: OpenAI GPT-4o com JSON mode forcado
Latencia alvo: <500ms
Custo: ~$0.002/mensagem

**2.2 Schema de Output Estruturado**

Cat retorna JSON estrito. Usar function calling ou structured output do OpenAI para garantir schema compliance:

```typescript
interface CatOutput {
  intent: string;           // enum de intents
  subIntent?: string;       // sub-classificacao
  entities: {
    propertyType?: string;
    neighborhoods?: string[];
    priceRange?: { min?: number; max?: number };
    bedrooms?: { min?: number; max?: number };
    amenities?: string[];
    urgency?: 'low' | 'medium' | 'high';
    transaction?: 'sale' | 'rent' | 'investment';
  };
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  leadScoreDelta: number;   // -10 a +20
  leadStageChange?: string; // nova stage se houver transicao
  requiresPropertySearch: boolean;
  requiresKnowledgeBase: boolean;
  tags: string[];           // tags para categorizar o lead
}
```

**2.3 Few-Shot Prompt Bank**

Criar banco de 20-30 exemplos reais por intent para few-shot learning:
- 5 exemplos de greeting/saudacao
- 5 exemplos de busca de imovel (variando complexidade)
- 3 exemplos de pergunta sobre preco/financiamento
- 3 exemplos de agendamento de visita
- 3 exemplos de reclamacao/frustracoes
- 2 exemplos de negociacao
- 2 exemplos de perguntas sobre documentacao

Arquivo: `apps/agents/src/cat/prompts.ts`

**2.4 Integrar Cat no Pipeline**

Modificar `apps/api/src/workers/orchestrator.ts`:

```
[Context Builder] -> [Cat Agent] -> [Vera Agent] -> [Atlas (basico)]
```

Cat enriquece o contexto com sua saida. Vera recebe:
- Mensagem original do lead
- Historico da sessao (Redis)
- Lead profile (PostgreSQL)
- **Output do Cat** (intent, entities, sentiment, score)
- Imoveis relevantes (se Cat marcou `requiresPropertySearch: true`)

**2.5 Lead Score System**

Implementar logica de scoring cumulativo:

| Sinal | Delta | Condicao |
|-------|-------|----------|
| Primeira mensagem | +10 | Sempre |
| Menciona orcamento | +15 | Entidade priceRange detectada |
| Pede detalhes de imovel | +10 | Intent = property_details |
| Agenda visita | +20 | Intent = visit_request |
| Pergunta financiamento | +15 | Intent = financing |
| Resposta rapida (<5min) | +5 | Tempo entre mensagens |
| Negociacao de preco | +20 | Intent = price_negotiation |
| Sentiment negativo | -5 | Sentiment = negative |
| Sentiment frustrado | -10 | Sentiment = frustrated |
| Inatividade >24h | -15 | Cron job |

Persistir via RPC `update_lead_score()` ja definido na arquitetura.

**2.6 Migracao de Schema**

Tabelas necessarias (ja no DDL da arquitetura):
- `contacts` com campos `lead_score`, `lead_stage`, `preferences`
- `lead_events` para auditoria de mudancas

Adicionar:
- Tabela `visits` (faltante na arquitetura original, ver ARCHITECTURE_REVIEW.md)

### Criterios de Aceite da Fase 2

- [ ] Cat classifica intent corretamente em 85%+ dos casos (testar com 50 mensagens reais em portugues)
- [ ] Lead score e atualizado a cada mensagem e persistido em `contacts`
- [ ] Lead events registram toda mudanca de score e stage
- [ ] Vera recebe output do Cat e usa para contextualizar resposta
- [ ] Tempo total do pipeline (Cat + Vera) < 5s P95
- [ ] Testes unitarios para cada intent com 3+ exemplos

### Riscos Especificos

| Risco | Mitigacao |
|-------|-----------|
| GPT-4o retorna JSON invalido | Retry com temperature=0, usar structured output |
| Classificacao errada impacta Vera | Cat output e sugestivo, nao autoritativo -- Vera pode ignorar |
| Custo de Cat + Vera juntos excede target | Cat com GPT-4o-mini como fallback ($0.0005/msg) |

### Estimativa: 2-3 semanas

- Semana 1: Cat agent core + few-shot prompts + testes
- Semana 2: Integracao no pipeline + lead score system
- Semana 3 (se necessario): Refinamento de prompts + benchmark de acuracia

---

## Fase 3: Cy Agent (Copywriting e Recomendacoes)

### Objetivo
Elevar a qualidade das mensagens enviadas ao lead com formatacao profissional, CTAs contextuais, e apresentacao persuasiva de imoveis.

### Escopo Tecnico

**3.1 Estrategia de Implementacao: Integrado vs Separado**

[AUTO-DECISION] Cy como modulo separado vs integrado na Vera?
-> Implementar como MODULO SEPARADO no codigo, mas INTEGRADO na LLM call da Vera por default.

Explicacao:
- O system prompt da Vera ja inclui instrucoes de formatacao WhatsApp e copywriting
- Cy como pos-processador separado so e ativado quando:
  (a) Tenant tem customizacao avancada de copy
  (b) Mensagem envolve apresentacao de imoveis (formatacao complexa)
  (c) Tenant e plano professional/enterprise

Isso economiza 1 LLM call na maioria dos cenarios.

**3.2 Cy como Pos-Processador (quando ativado)**

Arquivo: `apps/agents/src/cy/agent.ts`

Responsabilidades quando ativado como agente separado:
- Receber resposta raw da Vera + dados dos imoveis
- Reformatar para WhatsApp (bold, italic, listas, emojis estrategicos)
- Adicionar CTAs contextualizados baseados no funnel stage
- Adaptar tom ao perfil do lead (formal vs casual)
- Garantir max 4 paragrafos, max 4096 chars

**3.3 Template System para Imoveis**

Arquivo: `apps/agents/src/cy/templates.ts`

Templates reutilizaveis para apresentacao de imoveis no WhatsApp:

```
Template: property_card_single
---
{emoji_type} *{title}*

{bedrooms} quartos | {bathrooms} banh. | {area_m2}m2
{neighborhood}, {city}

*R$ {price_formatted}*
{condo_fee ? "Condominio: R$ " + condo_fee : ""}

{highlight_1}
{highlight_2}

{cta}
---

Template: property_list (top 3)
---
Encontrei opcoes otimas para voce:

1. *{title_1}* - {neighborhood_1}
   {bedrooms_1} quartos | R$ {price_1}

2. *{title_2}* - {neighborhood_2}
   {bedrooms_2} quartos | R$ {price_2}

3. *{title_3}* - {neighborhood_3}
   {bedrooms_3} quartos | R$ {price_3}

Qual te interessou mais? Posso enviar fotos e detalhes!
---
```

**3.4 CTA Engine**

CTAs contextuais baseados no estado do lead:

| Funnel Stage | CTA Primario | CTA Secundario |
|-------------|-------------|----------------|
| new | "Quer me contar o que procura?" | -- |
| engaged | "Posso buscar opcoes para voce?" | "Tem alguma regiao preferida?" |
| interested | "Quer ver fotos desse imovel?" | "Posso enviar mais opcoes similares?" |
| qualified | "Quer agendar uma visita?" | "Posso verificar disponibilidade?" |
| visiting | "Como foi a visita?" | "Quer ver outro imovel parecido?" |
| negotiating | "Posso conectar voce com nosso consultor?" | -- |

**3.5 Integracao com Envio de Imagens**

Quando Cy formata apresentacao de imovel, orquestra envio de multiplas mensagens:
1. Mensagem de texto com dados do imovel
2. Imagem principal (via Evolution API sendImage)
3. Imagens adicionais (max 3, sob demanda)

O envio de imagens e assincrono -- nao bloqueia o pipeline.

### Criterios de Aceite da Fase 3

- [ ] Mensagens formatadas corretamente para WhatsApp (bold, listas, emojis)
- [ ] Templates de imoveis geram apresentacao profissional
- [ ] CTAs sao contextuais ao funnel stage do lead
- [ ] Imagens de imoveis enviadas junto com texto
- [ ] Latencia adicional do Cy < 100ms quando integrado na Vera
- [ ] Latencia do Cy separado < 800ms

### Estimativa: 1-2 semanas

- Semana 1: Template system + CTA engine + integracao no prompt da Vera
- Semana 2 (se necessario): Cy separado para cenarios avancados + testes de formatacao

---

## Fase 4: Atlas Agent (Orquestracao e Escalacao)

### Objetivo
Implementar o "CEO" do sistema -- supervisao em tempo real, escalacao inteligente para corretor humano, content safety, e monitoramento de KPIs.

### Escopo Tecnico

**4.1 Atlas Decision Engine**

Arquivo: `apps/agents/src/atlas/agent.ts`

Atlas opera em dois modos:
1. **Rules mode** (sem LLM, <50ms) -- para decisoes claras
2. **LLM mode** (Claude Sonnet, <2s) -- para decisoes ambiguas

Rules mode cobre 90%+ das decisoes:

```typescript
interface AtlasDecision {
  action: 'send_ai_response' | 'escalate_to_human' | 'block_response';
  reason: string;
  escalation?: {
    reason: string;
    priority: 'normal' | 'urgent';
    assignTo?: string;     // corretor especifico
    context: string;       // resumo para o corretor
  };
  contentModification?: {
    type: 'rewrite' | 'append' | 'remove';
    target: string;
    replacement?: string;
  };
}
```

**4.2 Regras de Escalacao**

```
ESCALACAO IMEDIATA (sem threshold):
- Cliente pede explicitamente para falar com humano
- Sentiment = frustrated em 2+ mensagens consecutivas
- Questoes juridicas/contratuais detectadas
- Tentativa de jailbreak detectada

ESCALACAO POR SCORE:
- lead_score >= 80 (padrao, configuravel por tenant)
- lead_stage = 'negotiating'
- lead_stage = 'visiting' + 3+ mensagens sobre preco

ESCALACAO POR CONFIANCA:
- Vera reporta confidence < 0.3
- Cat nao consegue classificar intent (intent = 'unknown')
- 3+ perguntas consecutivas sem resposta adequada
```

**4.3 Handoff Protocol**

Quando Atlas decide escalar:

1. **Notificacao ao corretor:**
   - Via WhatsApp (grupo interno) ou webhook (configuravel por tenant)
   - Conteudo: nome do lead, score, intencao, resumo de 3 linhas, preferencias, imoveis mostrados

2. **Mensagem ao lead:**
   - Vera gera mensagem de transicao natural ("Vou conectar voce com {nome_corretor}, nosso especialista...")
   - Mensagem inclui contexto para que o lead nao sinta "restart"

3. **Mudanca de estado:**
   - `conversations.status = 'human_takeover'`
   - `conversations.escalated_at = NOW()`
   - `conversations.escalated_to = '{corretor}'`
   - Redis session atualizada: `status: 'human_takeover'`

4. **Modo pos-handoff:**
   - Mensagens do lead sao encaminhadas ao corretor (nao processadas pela IA)
   - Corretor pode devolver ao bot via comando `/bot resume` no WhatsApp

**4.4 Content Safety Filter**

Arquivo: `apps/agents/src/atlas/rules.ts`

Pre-envio de toda mensagem da IA:

| Regra | Acao | Exemplo |
|-------|------|---------|
| PII de proprietario | BLOQUEAR | "O CPF do dono e..." |
| Garantia de preco | REESCREVER | "Garanto esse preco" -> "O preco anunciado e..." |
| Promessa de valorizacao | REESCREVER | "Vai valorizar 30%" -> "A regiao tem historico de valorizacao" |
| Informacao juridica | ESCALAR | "O contrato deve conter..." |
| Discriminacao | BLOQUEAR | Qualquer conteudo discriminatorio |

**4.5 KPI Dashboard Backend**

Endpoint: `GET /dashboard/kpis`

Metricas calculadas em real-time:

```typescript
interface DashboardKPIs {
  period: string;           // 'today' | 'week' | 'month'
  tenantId: string;

  // Volume
  totalLeads: number;
  newLeadsToday: number;
  activeConversations: number;

  // Performance
  avgResponseTimeMs: number;
  avgLeadScore: number;
  scoreDistribution: { range: string; count: number }[];

  // Conversao
  escalationRate: number;   // % escalados
  conversionRate: number;   // % que agendaram visita
  abandonmentRate: number;  // % que pararam de responder

  // Custo
  totalTokensUsed: number;
  estimatedCost: number;
  costPerConversation: number;
}
```

**4.6 Anomaly Detection (Basico)**

Atlas monitora metricas a cada hora e alerta se:
- Tempo medio de resposta > 30s (2x normal)
- Taxa de escalacao < 5% ou > 40% (anomalia)
- Taxa de abandono > 50% (problema de qualidade)
- Queue depth > 100 jobs (backpressure)

Alertas enviados via WhatsApp ao gerente do tenant.

### Criterios de Aceite da Fase 4

- [ ] Escalacao automatica funciona quando lead_score >= threshold
- [ ] Corretor recebe notificacao com resumo completo do lead
- [ ] Lead recebe mensagem de transicao natural antes do handoff
- [ ] Apos handoff, mensagens do lead nao sao processadas pela IA
- [ ] Corretor pode devolver conversa ao bot via comando
- [ ] Content filter bloqueia/reescreve conteudo problematico
- [ ] Endpoint /dashboard/kpis retorna metricas corretas
- [ ] Alertas de anomalia sao enviados quando thresholds sao ultrapassados

### Riscos Especificos

| Risco | Mitigacao |
|-------|-----------|
| Escalacao excessiva (muitos false positives) | Threshold configuravel por tenant, logging de todas as decisoes |
| Corretor nao responde apos escalacao | Timeout de 10min, re-escalar para outro corretor ou devolver ao bot |
| Content filter bloqueia respostas legitimas | Log de todos os bloqueios, revisao semanal, whitelist de padroes |

### Estimativa: 2-3 semanas

- Semana 1: Decision engine + regras de escalacao + handoff protocol
- Semana 2: Content safety + KPI backend + testes de integracao
- Semana 3 (se necessario): Anomaly detection + refinamento de thresholds

---

## Fase 5: Leo Agent (Learning e Analise)

### Objetivo
Fechar o ciclo de aprendizado continuo. Leo analisa conversas, detecta padroes, propoe melhorias de prompts, e gera relatorios automaticos. Este e o diferencial competitivo do IMOBX -- o sistema que melhora sozinho.

### Escopo Tecnico

**5.1 Conversation Analytics Pipeline**

Arquivo: `packages/learning/src/analyzer.ts`

Job agendado (cron a cada 6h) que processa conversas encerradas:

```
[Cron Trigger]
    |
    v
[Coleta] -- SELECT conversas com 3+ msgs das ultimas 6h
    |
    v
[Agrupamento] -- Agrupa por tenant
    |
    v
[Analise GPT-4o] -- Batch de conversas por tenant
    |
    v
[Metricas] -- Calcula KPIs do periodo
    |
    v
[Insights] -- Identifica padroes e anomalias
    |
    v
[Output]
    +-- INSERT analysis_reports
    +-- INSERT knowledge_base (FAQs aprendidas)
    +-- INSERT prompt_suggestions (melhorias propostas)
```

**5.2 Pattern Detection**

Arquivo: `packages/learning/src/pattern-detector.ts`

Padroes que Leo detecta automaticamente:

| Padrao | Como detecta | Acao |
|--------|-------------|------|
| FAQ recorrente | Mesma pergunta 5+ vezes em 7 dias | Adiciona a knowledge_base |
| Ponto de abandono | Mensagem N media onde leads param de responder | Sugere melhoria de prompt naquele ponto |
| Objecao comum | Mesma objecao 10+ vezes em 7 dias | Cria template de resposta |
| Horario de pico | Volume de mensagens por hora do dia | Sugere escalacao de corretores |
| Bairro mais buscado | Top-5 bairros por volume | Sugere aumentar portfolio |
| Conversao por intent | Quais intents levam a escalacao/visita | Prioriza esses fluxos |

**5.3 Prompt Optimization Suggestions**

Arquivo: `packages/learning/src/prompt-optimizer.ts`

Leo analisa conversas bem-sucedidas vs abandonadas e sugere mudancas nos prompts:

```typescript
interface PromptSuggestion {
  agentName: 'vera' | 'cat' | 'cy';
  promptSection: string;    // qual parte do prompt mudar
  currentText: string;      // texto atual
  suggestedText: string;    // texto proposto
  reason: string;           // baseado em quais dados
  expectedImpact: 'low' | 'medium' | 'high';
  autoApply: boolean;       // true para baixo risco (FAQ), false para prompts
  basedOnConversations: number; // quantas conversas analisadas
}
```

Processo de aplicacao:
1. `autoApply = true` (FAQs, knowledge base): aplicado automaticamente
2. `autoApply = false` (prompts dos agentes): salvo em `prompt_suggestions`, requer aprovacao humana
3. Apos aprovacao, novo prompt e salvo em `prompt_versions` com version incrementado

**5.4 Weekly Report Generation**

Arquivo: `packages/learning/src/report-generator.ts`

Job semanal (segunda 8h) que gera relatorio por tenant:

Conteudo do relatorio:
- Total de leads na semana vs semana anterior
- Taxa de qualificacao (leads com score > 50)
- Top-5 bairros mais buscados
- Top-5 objecoes mais comuns
- Imoveis mais vistos vs imoveis convertidos
- Custo total de IA na semana
- Resumo em 3 bullet points

Formato: texto otimizado para WhatsApp (<2000 chars)
Envio: via WhatsApp ao numero do gerente (configurado em `tenants.evolution_config`)

**5.5 Feedback Loop (Resultado de Vendas)**

Corretor reporta resultado via comando WhatsApp:

```
/resultado +5511999887766 venda
/resultado +5511999887766 nao_venda
/resultado +5511999887766 em_andamento
```

Dados persistidos em `contacts`:
```sql
ALTER TABLE contacts ADD COLUMN sale_result TEXT
    CHECK (sale_result IN ('pending', 'sale', 'no_sale', 'in_progress'));
ALTER TABLE contacts ADD COLUMN sale_result_at TIMESTAMPTZ;
```

Leo usa esses dados para:
1. Correlacionar: score no momento do handoff vs resultado real
2. Calibrar scoring: se leads com score 80 nao convertem, ajustar pesos
3. Calcular acuracia do modelo de scoring (meta: 70%+)

**5.6 A/B Testing de Prompts (Basico)**

Sistema simples de A/B testing:
- Dois prompts ativos simultaneamente para o mesmo agente
- 50% das conversas usam prompt A, 50% usam prompt B
- Apos 100 conversas, Leo compara metricas e sugere o vencedor
- Metricas comparadas: engagement rate, escalation rate, avg conversation length

### Criterios de Aceite da Fase 5

- [ ] Pipeline de analise roda automaticamente a cada 6h sem falhas
- [ ] FAQs recorrentes sao adicionadas automaticamente a knowledge_base
- [ ] Sugestoes de melhoria de prompt sao geradas e armazenadas
- [ ] Relatorio semanal e enviado automaticamente via WhatsApp
- [ ] Feedback de vendas e registrado e usado para calibrar scoring
- [ ] Metricas de acuracia do scoring sao calculadas semanalmente
- [ ] A/B testing funciona para pelo menos 1 agente

### Riscos Especificos

| Risco | Mitigacao |
|-------|-----------|
| Custo de GPT-4o para analise de batch | Limitar batch a 50 conversas por execucao, usar GPT-4o-mini para metricas simples |
| FAQs aprendidas incorretas | Tag `source: learned` + revisao semanal pelo gerente |
| A/B testing com amostra insuficiente | Minimo 100 conversas antes de concluir, alertar se amostra e pequena |
| Prompt optimization piora qualidade | Rollback automatico se metricas caem 10% apos mudanca |

### Estimativa: 3-4 semanas

- Semana 1: Analytics pipeline + pattern detection
- Semana 2: Report generation + prompt optimizer
- Semana 3: Feedback loop + scoring calibration
- Semana 4 (se necessario): A/B testing + refinamentos

---

## Dependencias entre Fases

```
Fase 1 (Vera) ──┐
                 ├──> Fase 2 (Cat) ──> Fase 4 (Atlas)
                 │                         |
                 └──> Fase 3 (Cy)          |
                                           v
                                    Fase 5 (Leo)
```

**Fase 2 depende de Fase 1:** Cat precisa do pipeline basico funcionando (webhook -> worker -> LLM call)
**Fase 3 pode ser paralela a Fase 2:** Cy trabalha na formatacao da saida da Vera, nao depende do Cat
**Fase 4 depende de Fase 2:** Atlas precisa do lead score do Cat para decisoes de escalacao
**Fase 5 depende de Fase 4:** Leo analisa dados que so existem apos Atlas estar operacional (escalacoes, KPIs)

### Caminho Critico

```
Fase 1 -> Fase 2 -> Fase 4 -> Fase 5
```

Fase 3 (Cy) pode ser feita em paralelo com Fase 2 ou inserida entre Fase 2 e 4.

---

## Metricas de Sucesso por Fase

| Fase | Metrica Principal | Target |
|------|------------------|--------|
| 2 (Cat) | Acuracia de classificacao de intent | >= 85% |
| 2 (Cat) | Latencia adicional ao pipeline | < 500ms |
| 3 (Cy) | NPS de qualidade de mensagem (avaliacao interna) | >= 4/5 |
| 3 (Cy) | Latencia adicional (quando separado) | < 800ms |
| 4 (Atlas) | Taxa de escalacao correta (precision) | >= 90% |
| 4 (Atlas) | Tempo de escalacao (detect -> notify) | < 5s |
| 5 (Leo) | FAQs detectadas por semana | >= 3 novas |
| 5 (Leo) | Reducao de custo via prompt optimization | >= 10% |

---

## Custos Estimados por Conversa Completa (Todas as Fases)

| Componente | Custo/msg | Msgs/conversa | Total |
|-----------|----------|---------------|-------|
| Cat (GPT-4o) | $0.002 | 10 | $0.020 |
| Vera (Claude Sonnet) | $0.010 | 10 | $0.100 |
| Cy (integrado na Vera) | $0.000 | 10 | $0.000 |
| Atlas (regras, sem LLM) | $0.000 | 10 | $0.000 |
| Embeddings (busca imoveis) | $0.0001 | 3 | $0.0003 |
| **Total por conversa** | | | **~$0.12** |

**Conversao para BRL (USD 5.00):** R$ 0.60 por conversa completa (10 msgs).
**Target do PRD:** R$ 2.00 -- com boa margem.

**Leo (batch, nao por conversa):** ~$0.50 por execucao (4x/dia = $2.00/dia = $60/mes)

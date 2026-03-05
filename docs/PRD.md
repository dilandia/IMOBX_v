# IMOBX - Product Requirements Document (PRD)

## Change Log

| Date       | Version | Description                          | Author          |
|------------|---------|--------------------------------------|-----------------|
| 2026-03-04 | 1.0     | Initial PRD creation                 | Morgan (PM)     |

---

## 1. Goals

- Eliminar a perda de leads imobiliarios por demora no atendimento via WhatsApp, garantindo resposta em menos de 30 segundos 24/7
- Automatizar 80%+ dos atendimentos de primeiro contato ate qualificacao completa do lead, liberando corretores para fechamento
- Oferecer atendimento humanizado e contextualizado via IA que aprende continuamente com cada interacao
- Criar uma plataforma SaaS escalavel onde imobiliarias conectam seu WhatsApp Business e comecam a operar em menos de 1 hora
- Gerar dados de inteligencia comercial (lead scoring, preferencias, padroes de comportamento) que aumentem a taxa de conversao em pelo menos 25%

## 2. Background Context

O mercado imobiliario brasileiro sofre de um problema cronico: leads gerados por anuncios pagos (Meta Ads, Google Ads) chegam via WhatsApp e ficam sem resposta por horas ou dias. Estudos de mercado indicam que 78% dos leads imobiliarios escolhem o primeiro corretor que responde. A janela de oportunidade e de minutos, nao de horas.

Corretores independentes e imobiliarias de pequeno/medio porte nao tem estrutura para manter atendimento 24/7. Mesmo com equipes, o atendimento e inconsistente, perde contexto entre interacoes, e nao segue processos de qualificacao padronizados. O IMOBX resolve isso colocando um squad de agentes de IA autonomos no WhatsApp do cliente, cada um com papel especializado (atendimento, copywriting, categorizacao, analise), operando como uma equipe comercial completa que nunca dorme, nunca esquece um lead, e melhora a cada atendimento.

---

## 3. Requirements

### 3.1 Functional Requirements

- **FR1:** O sistema deve receber mensagens de WhatsApp via Evolution API (self-hosted) e rotear para o agente apropriado em menos de 2 segundos
- **FR2:** O agente Vera (Attendant) deve responder ao lead em linguagem natural humanizada, sem parecer um bot, adaptando tom e vocabulario ao perfil do lead
- **FR3:** O agente Cat (Categorizer) deve classificar cada lead com um score de 0-100 baseado em: urgencia de compra, capacidade financeira estimada, clareza de preferencias, engajamento na conversa
- **FR4:** O sistema deve manter memoria persistente por lead, recuperando contexto de conversas anteriores em qualquer nova interacao
- **FR5:** O agente Cy (Copywriter) deve gerar mensagens persuasivas contextualizadas, incluindo apresentacao de imoveis com fotos, metragem, preco, localizacao
- **FR6:** O sistema deve realizar busca semantica no banco de imoveis, encontrando matches por descricao natural (ex: "apartamento 3 quartos proximo ao metrô com vaga")
- **FR7:** O agente Atlas (CEO) deve monitorar KPIs em tempo real e escalar leads quentes para corretor humano automaticamente quando score >= 80
- **FR8:** O agente Leo (Analyst) deve analisar padroes de atendimento e gerar relatorios semanais com insights e sugestoes de melhoria de prompts
- **FR9:** O sistema deve suportar handoff transparente para corretor humano, transferindo todo o contexto da conversa sem perda de informacao
- **FR10:** O sistema deve suportar multiplos numeros WhatsApp (multi-tenancy) com isolamento completo de dados entre clientes
- **FR11:** O sistema deve processar e entender mensagens de audio (speech-to-text) enviadas pelo lead via WhatsApp
- **FR12:** O sistema deve permitir cadastro e atualizacao de imoveis via API REST e importacao de CSV/planilhas
- **FR13:** O sistema deve detectar intencao de compra vs aluguel vs investimento e adaptar o fluxo de conversa
- **FR14:** O sistema deve permitir configuracao de horario de atendimento humano, onde a IA informa disponibilidade e agenda visita/ligacao
- **FR15:** O sistema deve registrar todas as conversas para auditoria, compliance e treinamento do modelo
- **FR16:** O sistema deve suportar fallback para atendimento humano quando a IA nao consegue responder com confianca (threshold configuravel)

### 3.2 Non-Functional Requirements

- **NFR1:** Tempo de resposta da IA ao lead deve ser inferior a 5 segundos (P95) para manter naturalidade da conversa
- **NFR2:** O sistema deve suportar 500 conversas simultaneas por instancia sem degradacao de performance
- **NFR3:** Disponibilidade de 99.5% (maximo 3.6h de downtime por mes), dado que leads chegam 24/7
- **NFR4:** Dados de conversas devem ser criptografados em repouso (AES-256) e em transito (TLS 1.3)
- **NFR5:** Isolamento completo de dados entre tenants -- nenhuma imobiliaria pode acessar dados de outra
- **NFR6:** O sistema deve funcionar com latencia de rede de ate 200ms sem impacto perceptivel ao lead
- **NFR7:** Logs estruturados com rastreabilidade completa (request ID por mensagem) para debugging
- **NFR8:** Backup diario automatico do banco de dados com retencao de 30 dias
- **NFR9:** O sistema deve ser deployavel em VPS com 4GB RAM / 2 vCPU como minimo para MVP
- **NFR10:** Taxa de acerto da busca semantica de imoveis deve ser >= 85% (relevancia dos top-3 resultados)
- **NFR11:** Custo de IA por conversa completa (lead-to-handoff) deve ficar abaixo de R$2,00

---

## 4. Personas

### 4.1 Cliente da Plataforma: Imobiliaria / Corretor

**Nome:** Ricardo, 42 anos, dono de imobiliaria com 8 corretores em Sao Paulo

**Contexto:** Investe R$15.000/mes em Meta Ads e Google Ads. Gera ~400 leads/mes pelo WhatsApp. Sua equipe consegue atender no maximo 60% no mesmo dia. Os outros 40% esfriam e sao perdidos. Ja tentou chatbots tradicionais mas os leads reclamavam do atendimento robotico.

**Dores:**
- Perde leads por demora no atendimento (fora do horario comercial, finais de semana)
- Equipe atende de forma inconsistente -- cada corretor tem seu estilo
- Nao tem dados estruturados sobre preferencias e comportamento dos leads
- Gasta tempo com leads desqualificados que nunca vao comprar

**Necessidades:**
- Atendimento automatico 24/7 que pareca humano
- Qualificacao automatica para focar corretores nos leads quentes
- Dashboard com metricas de conversao e performance
- Integracao simples com seu WhatsApp Business existente

### 4.2 Cliente da Plataforma: Corretor Independente

**Nome:** Juliana, 28 anos, corretora autonoma no Rio de Janeiro

**Contexto:** Trabalha sozinha, atende ~50 leads/mes. Perde metade por nao conseguir responder rapido enquanto esta em visitas ou reunioes. Seu diferencial e atendimento personalizado, mas nao escala.

**Dores:**
- Nao pode responder WhatsApp enquanto esta com cliente presencial
- Perde contexto entre conversas quando retoma contato dias depois
- Nao tem processo estruturado de qualificacao
- Gasta horas respondendo perguntas repetitivas sobre os mesmos imoveis

**Necessidades:**
- IA que responda por ela quando esta indisponivel, mantendo seu tom pessoal
- Resumo automatico de cada lead quando ela reassume a conversa
- Busca inteligente no portfolio para sugerir imoveis sem precisar procurar manualmente

### 4.3 Usuario Final: Lead Imobiliario

**Nome:** Marcos, 35 anos, procurando apartamento para compra

**Contexto:** Viu anuncio no Instagram, clicou e foi direcionado ao WhatsApp. Quer informacoes rapidas sobre imoveis na regiao que procura. Se nao recebe resposta em 10 minutos, manda mensagem para outra imobiliaria.

**Expectativas:**
- Resposta imediata e relevante
- Nao quer preencher formularios -- quer conversar naturalmente
- Quer ver fotos, precos e detalhes dos imoveis no proprio WhatsApp
- Espera que quem o atende lembre do que ja conversaram

---

## 5. Technical Assumptions

### 5.1 Repository Structure: Monorepo

Monorepo com separacao clara de modulos por responsabilidade. Justificativa: facilita deploy unificado no MVP, compartilhamento de tipos/interfaces entre agentes, e simplifica CI/CD em fase inicial.

### 5.2 Service Architecture

Monolito modular com Fastify. Cada agente de IA e um modulo independente dentro do monolito, com interface bem definida. Isso permite extrair para microservicos no futuro sem reescrita, mas evita a complexidade operacional de servicos distribuidos no MVP.

Componentes:
- **Gateway Layer:** Fastify HTTP + WebSocket para Evolution API webhooks
- **Agent Orchestrator:** Router de mensagens para agentes baseado em contexto e intent
- **Agent Modules:** Atlas, Vera, Cy, Cat, Leo -- cada um com seu prompt system, tools, e memoria
- **Data Layer:** PostgreSQL + pgvector para dados estruturados e busca semantica
- **Cache Layer:** Redis para sessoes ativas, rate limiting, e cache de embeddings
- **Queue:** Bull (Redis-backed) para processamento assincrono de mensagens

### 5.3 Testing Requirements

- **Unit:** Jest para logica de negocio, parsing de mensagens, lead scoring
- **Integration:** Testes de integracao com banco de dados e Redis (testcontainers)
- **E2E:** Simulacao de conversas completas com mensagens mockadas da Evolution API
- **Coverage target:** 70% no MVP, 85% em producao estavel

### 5.4 Additional Technical Assumptions

- **WhatsApp Integration:** Evolution API v2 self-hosted, com webhook para receber mensagens e REST API para enviar. Instancia gerenciada pelo IMOBX, nao pelo cliente
- **AI Models:** Claude claude-sonnet-4-6 como modelo principal para conversacao (qualidade + custo), OpenAI text-embedding-3-small para embeddings de imoveis
- **Memory Architecture:** Memoria de curto prazo em Redis (conversa ativa, TTL 24h), memoria de longo prazo em PostgreSQL (historico completo, preferencias aprendidas)
- **Multi-tenancy:** Schema-level isolation no PostgreSQL (um schema por tenant) para seguranca e simplicidade de backup/restore
- **Deployment:** PM2 + Nginx em VPS, com possibilidade de containerizacao (Docker) no futuro
- **Observabilidade:** Pino (structured logging) + metricas custom em PostgreSQL (custo de IA, tempo de resposta, scores)

---

## 6. User Stories por Agente

### 6.1 Vera (Attendant) Stories

**US-V1:** Como lead, quero receber uma resposta acolhedora e personalizada em menos de 30 segundos apos enviar minha primeira mensagem, para que eu sinta que estou sendo atendido por alguem competente.

**US-V2:** Como lead, quero descrever o que procuro em linguagem natural (ex: "quero um ap de 2 quartos perto do parque por ate 500 mil") e receber sugestoes relevantes, para que eu nao precise preencher formularios.

**US-V3:** Como lead que retorna, quero que o atendimento lembre do que ja conversamos anteriormente, para que eu nao precise repetir minhas preferencias.

**US-V4:** Como lead, quero receber fotos e detalhes dos imoveis sugeridos diretamente no WhatsApp, para que eu possa avaliar sem sair da conversa.

**US-V5:** Como lead, quero poder agendar uma visita presencial ao imovel diretamente na conversa, para que o processo seja conveniente.

### 6.2 Cat (Categorizer) Stories

**US-C1:** Como corretor, quero que cada lead receba automaticamente um score de qualificacao (0-100), para que eu priorize meu tempo nos leads com maior probabilidade de fechar negocio.

**US-C2:** Como corretor, quero ver as preferencias mapeadas de cada lead (tipo de imovel, faixa de preco, regiao, urgencia), para que eu prepare uma abordagem personalizada quando assumir o contato.

**US-C3:** Como gerente de imobiliaria, quero que leads sejam automaticamente categorizados por estagio do funil (curioso, pesquisando, pronto para comprar), para que eu tenha visibilidade do pipeline.

### 6.3 Cy (Copywriter) Stories

**US-CY1:** Como Vera, quero que as mensagens enviadas ao lead sejam persuasivas e adaptadas ao seu perfil (linguagem formal vs informal, tecnica vs emocional), para que a conversao seja maximizada.

**US-CY2:** Como corretor, quero que a apresentacao de imoveis no WhatsApp seja profissional e atraente (com destaque para diferenciais), para que o lead se interesse em visitar.

### 6.4 Atlas (CEO) Stories

**US-A1:** Como gerente, quero ser notificado em tempo real quando um lead atinge score >= 80 (lead quente), para que um corretor humano assuma imediatamente.

**US-A2:** Como gerente, quero um dashboard com KPIs diarios (leads recebidos, tempo medio de resposta, taxa de qualificacao, leads escalados), para que eu acompanhe a performance.

**US-A3:** Como gerente, quero que o sistema detecte anomalias (ex: queda brusca na taxa de resposta, aumento de leads insatisfeitos) e me alerte, para que eu intervenha rapidamente.

### 6.5 Leo (Analyst) Stories

**US-L1:** Como gerente, quero relatorios semanais automaticos com insights sobre padroes de leads (horarios de pico, tipos de imovel mais buscados, objecoes mais comuns), para que eu ajuste minha estrategia de marketing.

**US-L2:** Como PM do IMOBX, quero que o sistema analise conversas que resultaram em handoff bem-sucedido vs leads perdidos, para que os prompts sejam continuamente melhorados.

---

## 7. Metricas de Sucesso

### 7.1 Metricas Primarias

| Metrica | Meta MVP | Meta 6 meses | Como medir |
|---------|----------|--------------|------------|
| Tempo medio de primeira resposta | < 30s | < 15s | Timestamp recebimento vs envio |
| Taxa de qualificacao automatica | 60% dos leads | 80% dos leads | Leads com score atribuido / total |
| Taxa de handoff para humano | 25% dos leads | 15% dos leads | Leads escalados com score >= 80 / total |
| Taxa de conversao (lead -> visita) | 15% | 25% | Visitas agendadas / leads atendidos |
| NPS do lead (pesquisa pos-atendimento) | >= 40 | >= 60 | Pesquisa automatica via WhatsApp |
| Custo por conversa completa | < R$2,00 | < R$1,50 | Custo API IA / numero de conversas |

### 7.2 Metricas Operacionais

| Metrica | Target | Como medir |
|---------|--------|------------|
| Uptime do sistema | 99.5% | Monitoramento PM2 + health checks |
| Latencia P95 de resposta | < 5s | Logs estruturados |
| Taxa de fallback para humano por incapacidade | < 10% | Conversas com flag "low_confidence" |
| Precisao da busca semantica | >= 85% | Avaliacao manual de amostra semanal |
| Retencao de clientes (imobiliarias) | > 90% mensal | Churn rate |

### 7.3 Metricas de Negocio

| Metrica | Target 3 meses | Target 12 meses |
|---------|----------------|-----------------|
| Clientes pagantes (imobiliarias) | 10 | 50 |
| MRR (Monthly Recurring Revenue) | R$5.000 | R$50.000 |
| CAC (Custo de Aquisicao de Cliente) | < R$500 | < R$300 |
| LTV/CAC ratio | > 3x | > 5x |

---

## 8. Riscos e Mitigacoes

### 8.1 Riscos Tecnicos

| Risco | Probabilidade | Impacto | Mitigacao |
|-------|--------------|---------|-----------|
| Banimento do numero WhatsApp por spam | Media | Critico | Rate limiting rigoroso, warm-up gradual do numero, respeitar opt-out, seguir politicas Meta Business |
| Latencia alta da API de IA degradando UX | Media | Alto | Cache de respostas comuns, pre-processamento de intencao local, fallback para respostas template |
| Evolution API instavel ou descontinuada | Baixa | Critico | Abstrair camada de integracao WhatsApp, ter baileys como fallback, monitorar saude da API |
| Custo de IA exceder target por conversa | Alta | Medio | Otimizar prompts, usar modelos menores para tarefas simples, cache agressivo de embeddings |
| Busca semantica retornando imoveis irrelevantes | Media | Alto | Benchmark continuo, feedback loop do corretor, refinamento de embeddings |

### 8.2 Riscos de Negocio

| Risco | Probabilidade | Impacto | Mitigacao |
|-------|--------------|---------|-----------|
| Rejeicao do mercado ("nao confio em IA atendendo meus clientes") | Media | Critico | Trial gratuito de 30 dias, modo shadow (IA sugere, humano aprova), metricas de conversao como prova |
| Regulamentacao de IA em atendimento ao consumidor | Baixa | Alto | Transparencia (informar que e IA quando exigido), logs completos, opt-out facil |
| Concorrente estabelecido lanca feature similar | Media | Medio | Foco em verticalizacao imobiliaria (nao ser chatbot generico), learning engine como moat |
| Churn alto por expectativa desalinhada | Media | Alto | Onboarding guiado, definir SLA claro, comunicacao proativa de limitacoes |

### 8.3 Riscos Operacionais

| Risco | Probabilidade | Impacto | Mitigacao |
|-------|--------------|---------|-----------|
| Dados sensiveis de leads vazados | Baixa | Critico | Criptografia em repouso, isolamento por tenant, audit logs, principio do minimo privilegio |
| Escala alem da capacidade da VPS | Media | Alto | Monitoramento de recursos, alertas em 80% de uso, plano de migracao para cloud documentado |
| Dependencia de um unico modelo de IA (Claude) | Media | Medio | Abstrair interface de LLM, testar com OpenAI GPT-4o como alternativa |

---

## 9. Roadmap MVP - 4 Fases

### Fase 1: Pipeline WhatsApp -> IA -> Resposta (Semanas 1-3)

**Objetivo:** Validar que a IA consegue receber uma mensagem do WhatsApp e responder de forma humanizada e rapida.

**Escopo:**
- Setup do projeto (Fastify + PostgreSQL + Redis + Evolution API)
- Webhook receiver para mensagens do WhatsApp
- Agente Vera (v1) com prompt basico de atendimento imobiliario
- Envio de resposta de volta ao WhatsApp via Evolution API
- Logging estruturado de todas as mensagens
- Multi-tenancy basico (1-2 clientes de teste)
- Health check endpoint

**Criterios de Aceite:**
- [ ] Lead envia mensagem no WhatsApp e recebe resposta da IA em < 10s
- [ ] Resposta e contextualizada (imobiliaria, nao generica)
- [ ] Conversa de multiplas mensagens mantém contexto (Redis)
- [ ] Logs registram toda a conversa com request IDs
- [ ] Sistema roda estavel por 24h sem restart

### Fase 2: DB de Imoveis + Busca Semantica (Semanas 4-6)

**Objetivo:** Permitir que a IA encontre e apresente imoveis reais do portfolio do cliente com base na descricao natural do lead.

**Escopo:**
- Schema de imoveis no PostgreSQL (tipo, quartos, preco, area, endereco, fotos, descricao)
- API REST para CRUD de imoveis + importacao CSV
- Geracao de embeddings (text-embedding-3-small) para descricoes de imoveis
- Busca semantica com pgvector (similarity search)
- Integracao Vera + busca: lead descreve, Vera apresenta top-3 matches
- Envio de imagens (fotos dos imoveis) via WhatsApp
- Agente Cy (v1) para formatacao profissional da apresentacao

**Criterios de Aceite:**
- [ ] Imobiliaria consegue cadastrar imoveis via API e CSV
- [ ] Lead descreve preferencias e recebe top-3 imoveis relevantes
- [ ] Busca semantica tem precisao >= 80% nos top-3
- [ ] Fotos sao enviadas no WhatsApp junto com detalhes
- [ ] Apresentacao do imovel e profissional e persuasiva (Cy)

### Fase 3: Memoria por Cliente + Lead Scoring (Semanas 7-9)

**Objetivo:** Criar persistencia de longo prazo por lead e qualificacao automatica para priorizar o trabalho dos corretores.

**Escopo:**
- Memoria de longo prazo em PostgreSQL (perfil do lead, preferencias aprendidas, historico)
- Agente Cat (v1): lead scoring (0-100) baseado em sinais da conversa
- Classificacao de intencao (compra vs aluguel vs investimento)
- Mapeamento de estagio do funil (curioso, pesquisando, pronto)
- Handoff automatico para corretor quando score >= 80
- Notificacao ao corretor (via WhatsApp separado ou webhook) com resumo do lead
- Agente Atlas (v1): monitoramento de KPIs basicos (leads/dia, tempo resposta, scores)

**Criterios de Aceite:**
- [ ] Lead que retorna tem contexto recuperado automaticamente
- [ ] Score de qualificacao e atribuido apos 3+ mensagens trocadas
- [ ] Corretor recebe notificacao com resumo quando lead atinge score >= 80
- [ ] Handoff inclui todo o historico da conversa
- [ ] Dashboard basico mostra KPIs do dia (Atlas)

### Fase 4: Learning Engine + Analytics (Semanas 10-12)

**Objetivo:** Fechar o ciclo de aprendizado continuo, onde o sistema melhora seus prompts e respostas com base em dados reais.

**Escopo:**
- Agente Leo (v1): analise de conversas bem-sucedidas vs perdidas
- Identificacao de padroes (horarios de pico, objecoes comuns, tipos mais buscados)
- Relatorio semanal automatico para o gerente
- Feedback loop: corretor marca se handoff resultou em venda
- Ajuste automatico de prompts baseado em performance (A/B testing basico)
- Deteccao de anomalias (Atlas v2): alertas proativos
- Processamento de audio (speech-to-text) para mensagens de voz

**Criterios de Aceite:**
- [ ] Relatorio semanal gerado automaticamente com insights acionaveis
- [ ] Feedback do corretor (venda sim/nao) e registrado e usado para refinar scoring
- [ ] Sistema identifica e reporta top-5 objecoes da semana
- [ ] Alertas de anomalia funcionam (ex: queda de 30% na taxa de resposta)
- [ ] Mensagens de audio sao transcritas e processadas como texto

---

## 10. Epic List

### Epic 1: Foundation & WhatsApp Pipeline

**Goal:** Estabelecer infraestrutura do projeto, integracao com WhatsApp via Evolution API, e o primeiro agente de IA (Vera v1) respondendo mensagens em tempo real.

### Epic 2: Property Database & Semantic Search

**Goal:** Criar banco de imoveis com busca semantica via pgvector, permitindo que Vera apresente imoveis reais ao lead com base em descricao natural, com formatacao profissional via Cy.

### Epic 3: Lead Memory, Scoring & Handoff

**Goal:** Implementar memoria persistente por lead, qualificacao automatica (Cat), handoff inteligente para corretor humano, e monitoramento basico de KPIs (Atlas v1).

### Epic 4: Learning Engine & Analytics

**Goal:** Fechar o loop de aprendizado continuo com analise de conversas (Leo), feedback loop do corretor, relatorios automaticos, deteccao de anomalias, e processamento de audio.

---

## 11. Epic Details

### Epic 1: Foundation & WhatsApp Pipeline

**Goal expandido:** Este epic estabelece toda a fundacao tecnica do IMOBX -- desde o setup do projeto (Fastify, PostgreSQL, Redis) ate a integracao bidirecional com WhatsApp via Evolution API. Ao final, um lead podera enviar mensagem no WhatsApp e receber resposta contextualizada da IA (Vera v1) em menos de 10 segundos, com logging completo e multi-tenancy basico.

#### Story 1.1: Project Scaffolding & Core Infrastructure

As a developer,
I want a fully configured Fastify project with PostgreSQL, Redis, and structured logging,
so that all subsequent features have a solid foundation to build upon.

**Acceptance Criteria:**
1. Projeto inicializado com Node.js + Fastify + TypeScript
2. PostgreSQL conectado via connection pool (pg ou knex)
3. Redis conectado para cache e sessoes
4. Pino configurado com structured logging (JSON, request IDs)
5. Variáveis de ambiente via dotenv com .env.example documentado
6. Health check endpoint retorna status de DB + Redis + uptime
7. PM2 ecosystem file configurado para desenvolvimento e producao
8. ESLint + Prettier configurados com regras do projeto
9. Jest configurado com pelo menos 1 teste de smoke passando

#### Story 1.2: Evolution API Integration - Receiving Messages

As a system,
I want to receive WhatsApp messages via Evolution API webhooks,
so that incoming lead messages are captured and routed for processing.

**Acceptance Criteria:**
1. Webhook endpoint registrado no Fastify para receber eventos da Evolution API
2. Parser de mensagens valida e extrai: sender, message text, timestamp, media type
3. Mensagens sao armazenadas no PostgreSQL com tenant_id, sender, content, timestamps
4. Rate limiting configurado (max 100 msgs/min por numero)
5. Mensagens invalidas ou duplicadas sao descartadas com log de warning
6. Teste de integracao simula webhook da Evolution API e valida persistencia

#### Story 1.3: Evolution API Integration - Sending Messages

As a system,
I want to send WhatsApp messages back to leads via Evolution API,
so that AI responses reach the lead on their WhatsApp.

**Acceptance Criteria:**
1. Modulo de envio com retry logic (3 tentativas, backoff exponencial)
2. Suporte a envio de texto, imagens, e documentos
3. Status de entrega rastreado (sent, delivered, read) quando disponivel
4. Queue (Bull) para processamento assincrono de envios
5. Fallback gracioso quando Evolution API esta indisponivel (mensagem enfileirada)
6. Teste unitario cobre cenarios de sucesso, falha, e retry

#### Story 1.4: Vera Agent v1 - Basic Conversational AI

As a lead,
I want to receive intelligent, humanized responses when I message the WhatsApp number,
so that I feel like I'm talking to a knowledgeable real estate consultant.

**Acceptance Criteria:**
1. Vera recebe mensagem do lead via fila e gera resposta via Claude claude-sonnet-4-6
2. System prompt configura persona de consultora imobiliaria (acolhedora, profissional)
3. Contexto da conversa atual (ultimas 10 mensagens) e enviado ao modelo
4. Resposta e enviada de volta ao lead via modulo de envio (Story 1.3)
5. Tempo total (recebimento -> resposta enviada) < 10 segundos (P95)
6. Custos de API sao logados por conversa para monitoramento
7. Conversas com mais de 20 mensagens mantém contexto sem degradacao

#### Story 1.5: Multi-Tenancy Foundation

As an IMOBX operator,
I want to support multiple real estate agencies on the same system,
so that each agency has isolated data and configuration.

**Acceptance Criteria:**
1. Tabela de tenants com: id, name, whatsapp_number, evolution_instance_id, config (JSON)
2. Toda mensagem recebida e associada ao tenant correto via numero WhatsApp
3. Queries filtram por tenant_id em todas as operacoes
4. Config por tenant inclui: nome da imobiliaria, tom de voz, horario de atendimento
5. Vera adapta sua persona baseada na config do tenant
6. Teste valida isolamento: mensagem do tenant A nao aparece em queries do tenant B

---

### Epic 2: Property Database & Semantic Search

**Goal expandido:** Este epic adiciona a capacidade de armazenar imoveis reais do portfolio de cada imobiliaria e encontra-los via busca semantica. O lead podera descrever o que procura em linguagem natural e Vera apresentara os melhores matches com fotos e detalhes, formatados profissionalmente pelo agente Cy.

#### Story 2.1: Property Data Model & CRUD API

As an agency admin,
I want to register and manage properties via API,
so that the AI has real inventory to present to leads.

**Acceptance Criteria:**
1. Schema de imoveis: id, tenant_id, tipo (casa/apto/terreno/comercial), quartos, banheiros, vagas, area_m2, preco, endereco, bairro, cidade, descricao, fotos (array URLs), status (ativo/vendido/reservado), created_at, updated_at
2. API REST: POST /properties, GET /properties/:id, PUT /properties/:id, DELETE /properties/:id, GET /properties (com filtros)
3. Validacao de campos obrigatorios e tipos
4. Filtros: tipo, quartos (min/max), preco (min/max), cidade, bairro, status
5. Paginacao com cursor-based pagination
6. Testes unitarios para validacoes e testes de integracao para CRUD

#### Story 2.2: CSV/Spreadsheet Import

As an agency admin,
I want to import properties from CSV files,
so that I can quickly populate my inventory without manual entry.

**Acceptance Criteria:**
1. Endpoint POST /properties/import aceita CSV (multipart/form-data)
2. Parser valida headers e mapeia colunas (com template CSV documentado)
3. Import e assincrono (Bull queue) com status rastreavel
4. Erros por linha sao reportados sem abortar todo o import
5. Limite de 1000 imoveis por import
6. Teste com CSV de 100 imoveis valida import completo

#### Story 2.3: Property Embeddings & Semantic Search

As a system,
I want to generate vector embeddings for properties and search them semantically,
so that leads can find properties using natural language descriptions.

**Acceptance Criteria:**
1. Embedding gerado via OpenAI text-embedding-3-small para cada imovel (concatenacao de descricao + tipo + bairro + cidade + detalhes)
2. Embeddings armazenados no PostgreSQL via pgvector (coluna embedding na tabela properties)
3. Endpoint POST /properties/search aceita query em texto livre
4. Retorna top-N matches ordenados por similaridade (cosine similarity)
5. Filtros adicionais (preco max, tipo) combinam com busca semantica
6. Benchmark de precisao: >= 80% de relevancia nos top-3 resultados
7. Embeddings sao regenerados quando imovel e atualizado

#### Story 2.4: Vera + Property Search Integration

As a lead,
I want to describe what I'm looking for and receive matching properties in the conversation,
so that I can evaluate options without leaving WhatsApp.

**Acceptance Criteria:**
1. Vera detecta intencao de busca de imovel na mensagem do lead
2. Extrai criterios de busca (tipo, quartos, preco, regiao) e faz busca semantica
3. Apresenta top-3 matches com: nome/titulo, tipo, quartos, area, preco, bairro, 1 destaque
4. Envia foto principal de cada imovel via WhatsApp
5. Lead pode pedir mais detalhes de um imovel especifico
6. Quando nao ha matches, Vera informa e sugere ampliar criterios

#### Story 2.5: Cy Agent v1 - Professional Property Formatting

As a lead,
I want property presentations to be professionally formatted and persuasive,
so that I feel confident about the properties being shown.

**Acceptance Criteria:**
1. Cy recebe dados do imovel e gera texto de apresentacao (max 500 chars para WhatsApp)
2. Destaca diferenciais do imovel (varanda gourmet, vista livre, recém reformado)
3. Adapta linguagem ao perfil do lead (formal vs casual, baseado em conversa anterior)
4. Inclui call-to-action contextualizado (agendar visita, pedir mais fotos, ver outro)
5. Formato visual limpo com emojis estrategicos e quebras de linha

---

### Epic 3: Lead Memory, Scoring & Handoff

**Goal expandido:** Este epic transforma o IMOBX de um atendente reativo em um sistema inteligente que lembra de cada lead, qualifica automaticamente, e sabe o momento certo de escalar para um humano. O agente Cat faz lead scoring, Atlas monitora KPIs, e o handoff transfere todo o contexto para o corretor.

#### Story 3.1: Lead Profile & Long-Term Memory

As a returning lead,
I want the AI to remember my preferences and history,
so that I don't have to repeat myself every time I message.

**Acceptance Criteria:**
1. Tabela lead_profiles: id, tenant_id, phone, name, preferences (JSONB), funnel_stage, score, first_contact, last_contact, conversation_count
2. Preferencias extraidas automaticamente da conversa: tipo, quartos, preco_range, regioes, urgencia
3. Vera consulta lead_profile antes de responder e usa contexto acumulado
4. Historico de conversas anteriores e resumido (nao enviado na integra ao LLM)
5. Teste valida: lead retorna apos 7 dias e Vera referencia preferencias anteriores

#### Story 3.2: Cat Agent v1 - Lead Scoring

As a real estate agent,
I want each lead to have an automatic qualification score,
so that I focus my time on leads most likely to close a deal.

**Acceptance Criteria:**
1. Cat analisa conversa e atribui score 0-100 baseado em: urgencia (tem prazo?), capacidade financeira (menciona orcamento?), clareza de preferencias (sabe o que quer?), engajamento (quantidade e qualidade das respostas)
2. Score atualizado a cada nova mensagem do lead
3. Classificacao de intencao: compra | aluguel | investimento | indefinido
4. Estagio do funil: curioso | pesquisando | comparando | pronto_para_fechar
5. Score e classificacoes armazenados em lead_profiles
6. Teste valida scoring: conversa de lead engajado (10 msgs, menciona orcamento) gera score >= 70

#### Story 3.3: Human Handoff System

As a real estate agent,
I want to be notified and receive full context when a hot lead is ready,
so that I can seamlessly take over the conversation.

**Acceptance Criteria:**
1. Quando score >= threshold (default 80, configuravel por tenant), sistema inicia handoff
2. Notificacao enviada ao corretor (WhatsApp ou webhook, configuravel) com: nome do lead, score, intencao, resumo de 3 linhas, preferencias, imoveis que viu
3. Vera informa ao lead que um especialista vai entrar em contato
4. Flag handoff_at registrado no lead_profile
5. Apos handoff, Vera para de responder automaticamente naquele lead (modo humano)
6. Corretor pode devolver lead para IA via comando (ex: /ia-resume)

#### Story 3.4: Atlas Agent v1 - KPI Dashboard

As an agency manager,
I want a real-time view of key performance indicators,
so that I can monitor my team's and the AI's performance.

**Acceptance Criteria:**
1. Endpoint GET /dashboard/kpis retorna: leads hoje, tempo medio de resposta, score medio, leads escalados, conversas ativas
2. Dados calculados em real-time a partir das tabelas existentes
3. Filtros: periodo (hoje, semana, mes), tenant_id
4. Atlas gera resumo textual dos KPIs (para envio via WhatsApp ao gerente, se desejado)
5. Alertas basicos: se tempo medio > 30s ou taxa de escalacao < 5%, Atlas registra warning

---

### Epic 4: Learning Engine & Analytics

**Goal expandido:** O epic final fecha o ciclo de aprendizado continuo. Leo analisa conversas para identificar padroes, Atlas detecta anomalias proativamente, e o feedback loop dos corretores permite refinar scoring e prompts. O sistema agora aprende com cada atendimento e melhora autonomamente.

#### Story 4.1: Conversation Analytics Pipeline

As an analyst (Leo),
I want to process completed conversations and extract actionable insights,
so that the system continuously improves.

**Acceptance Criteria:**
1. Job agendado (cron) processa conversas encerradas (sem mensagem ha 24h+)
2. Leo extrai: duracao total, numero de mensagens, imoveis apresentados, objecoes identificadas, resultado (handoff | abandonado | em andamento)
3. Dados armazenados em tabela conversation_analytics
4. Agregacoes disponivel: por dia, semana, tenant
5. Teste valida pipeline com 50 conversas mock

#### Story 4.2: Weekly Report Generation

As an agency manager,
I want to receive an automatic weekly report with insights,
so that I can make data-driven decisions about my marketing and sales strategy.

**Acceptance Criteria:**
1. Job semanal (segunda 8h) gera relatorio por tenant
2. Conteudo: total leads, taxa qualificacao, top-5 bairros buscados, top-5 objecoes, comparativo com semana anterior
3. Relatorio enviado via WhatsApp ao gerente (numero configurado)
4. Formato otimizado para WhatsApp (texto + bullet points, < 2000 chars)
5. Gerente pode solicitar relatorio sob demanda via comando

#### Story 4.3: Feedback Loop - Sale Outcome Tracking

As a real estate agent,
I want to report whether a handoff resulted in a sale,
so that the system can learn what makes a successful qualification.

**Acceptance Criteria:**
1. Corretor envia comando /resultado {lead_phone} {venda|nao_venda|em_andamento}
2. Resultado registrado no lead_profile com timestamp
3. Leo usa dados de resultado para correlacionar: score no momento do handoff vs resultado real
4. Metricas de acuracia do scoring atualizadas semanalmente
5. Quando acuracia cai abaixo de 70%, sistema sugere recalibracao

#### Story 4.4: Anomaly Detection (Atlas v2)

As an agency manager,
I want to be proactively alerted about unusual patterns,
so that I can intervene before problems escalate.

**Acceptance Criteria:**
1. Atlas monitora metricas a cada hora: volume de leads, tempo de resposta, taxa de handoff, taxa de abandono
2. Deteccao de anomalia baseada em desvio padrao (> 2 sigma da media movel de 7 dias)
3. Alerta enviado ao gerente via WhatsApp com: metrica afetada, valor atual vs esperado, sugestao de acao
4. Historico de alertas armazenado para analise de tendencias
5. Threshold de anomalia configuravel por tenant

#### Story 4.5: Voice Message Processing

As a lead,
I want to send voice messages and have them understood by the AI,
so that I can communicate in the way that's most natural for me.

**Acceptance Criteria:**
1. Sistema detecta mensagem de audio recebida via Evolution API
2. Audio enviado para speech-to-text (Whisper API ou similar)
3. Transcricao processada como mensagem de texto normal pelo pipeline existente
4. Vera confirma que entendeu o audio ("Entendi, voce esta procurando...")
5. Transcricao armazenada junto com a mensagem original
6. Latencia adicional do STT < 3 segundos para audios de ate 60s

---

## 12. Out of Scope (MVP)

Os seguintes itens estao explicitamente fora do escopo do MVP e serao considerados para versoes futuras:

- **Dashboard web completo** -- MVP usa endpoints de API + notificacoes via WhatsApp
- **App mobile nativo** -- WhatsApp e a interface primaria
- **Integracao com CRMs** (Salesforce, HubSpot, etc.) -- API REST permite integracao futura
- **Pagamento e billing automatizado** -- cobranca manual no MVP
- **Chatbot em outros canais** (Instagram DM, Telegram, site) -- foco exclusivo em WhatsApp
- **Treinamento customizado de modelo** (fine-tuning) -- usa prompt engineering no MVP
- **Assinatura digital de contratos** -- fora do escopo do atendimento inicial
- **Tour virtual / VR de imoveis** -- fora do escopo tecnico do MVP
- **Marketplace de imoveis entre imobiliarias** -- cada tenant tem seu proprio inventario

---

## 13. Checklist Results Report

### Executive Summary

- **Completude geral do PRD:** 92%
- **Escopo MVP:** Adequado (Just Right) -- 4 fases com incrementos logicos de valor
- **Prontidao para arquitetura:** READY -- decisoes tecnicas documentadas, constraints claros
- **Gaps mais criticos:** Detalhamento do modelo de pricing/billing (deliberadamente out of scope para MVP)

### Category Statuses

| Category                         | Status  | Critical Issues |
| -------------------------------- | ------- | --------------- |
| 1. Problem Definition & Context  | PASS    | Nenhum          |
| 2. MVP Scope Definition          | PASS    | Out of scope bem definido |
| 3. User Experience Requirements  | PASS    | Interface e WhatsApp, nao requer UI design |
| 4. Functional Requirements       | PASS    | 16 FRs + 11 NFRs bem especificados |
| 5. Non-Functional Requirements   | PASS    | Targets quantitativos definidos |
| 6. Epic & Story Structure        | PASS    | 4 epics, 19 stories com ACs |
| 7. Technical Guidance            | PASS    | Stack definido, decisoes documentadas |
| 8. Cross-Functional Requirements | PARTIAL | Modelo de pricing nao detalhado (intencional) |
| 9. Clarity & Communication       | PASS    | Linguagem clara, termos definidos |

### Top Issues

**HIGH:**
- Definir contrato de API da Evolution API v2 com detalhes de webhooks e eventos suportados (requer investigacao do Architect)
- Validar custo real por conversa com Claude claude-sonnet-4-6 via testes de carga com prompts reais

**MEDIUM:**
- Estrategia de migração caso Evolution API seja descontinuada (baileys como fallback precisa de PoC)
- Definir limites de storage por tenant (fotos de imoveis podem consumir espaco significativo)

**LOW:**
- Template de CSV para import poderia incluir mais campos opcionais
- Estrategia de warm-up do numero WhatsApp poderia ser mais detalhada

### Recommendations

1. Architect deve investigar contratos de API da Evolution API v2 antes de iniciar Epic 1
2. Realizar teste de custo com 100 conversas simuladas para validar target de R$2,00/conversa
3. Definir estrategia de storage de imagens (S3/MinIO vs filesystem) na fase de arquitetura

### Final Decision

**READY FOR ARCHITECT** -- O PRD esta completo, com decisoes tecnicas documentadas, riscos mapeados, e escopo adequado para 12 semanas de desenvolvimento. O Architect pode iniciar o design da arquitetura.

---

## 14. Next Steps

### Architect Prompt

Inicie o modo de criacao de arquitetura usando `/home/takez/IMOBX/docs/PRD.md` como input. O IMOBX e uma plataforma de atendimento imobiliario via WhatsApp com squad de agentes de IA. Stack definido: Node.js + Fastify + PostgreSQL + pgvector + Redis + Bull + Evolution API + Claude claude-sonnet-4-6. Foco em: design do Agent Orchestrator (routing de mensagens entre 5 agentes), schema multi-tenant com pgvector, e pipeline assincrono de processamento de mensagens. Monolito modular com potencial de extracao futura.

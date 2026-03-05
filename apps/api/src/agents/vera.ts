/**
 * Vera Agent - Atendente IA para leads imobiliarios
 *
 * Responsabilidades:
 * 1. Receber mensagem do lead
 * 2. Buscar contexto do lead em PostgreSQL
 * 3. Montar prompt contextualizado para Claude Sonnet
 * 4. Chamar Anthropic API com context window
 * 5. Retornar resposta humanizada
 *
 * Modelo: claude-sonnet-4-6
 * Target P95: <5s
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../services/database';
import { getRedisClient } from '../services/redis';

// ============================================================
// Types
// ============================================================

export interface VeraInput {
  leadMessage: string;
  senderPhone: string;
  senderName: string;
  tenantId: string;
  conversationId?: string;
}

export interface VeraResponse {
  message: string;
  confidence: number;
  tokensUsed: number;
  latencyMs: number;
  agentName: 'vera';
  metadata: {
    intent: string;
    sentiment: string;
    shouldEscalate: boolean;
    escalationReason?: string;
  };
}

interface ConversationMessage {
  sender_type: string;
  content: string;
  created_at: string;
  agent_name: string | null;
  [key: string]: unknown;
}

interface LeadContext {
  name: string | null;
  leadScore: number;
  leadStage: string;
  preferences: Record<string, unknown>;
  conversationCount: number;
  lastContactAt: string | null;
  recentMessages: ConversationMessage[];
}

interface TenantConfig {
  name: string;
  aiConfig: Record<string, unknown>;
}

// ============================================================
// System Prompt
// ============================================================

function buildSystemPrompt(tenant: TenantConfig, leadContext: LeadContext): string {
  const tenantName = tenant.name || 'a imobiliaria';
  const leadName = leadContext.name || 'cliente';
  const isReturning = leadContext.conversationCount > 0;

  const preferencesText = Object.keys(leadContext.preferences).length > 0
    ? `\nPreferencias conhecidas do lead: ${JSON.stringify(leadContext.preferences)}`
    : '';

  const returningContext = isReturning
    ? `\nEste e um lead que ja entrou em contato ${leadContext.conversationCount} vezes. Ultimo contato: ${leadContext.lastContactAt}. Nao peca informacoes que voce ja tem.`
    : '\nEste e o primeiro contato deste lead. Seja acolhedora e pergunte como pode ajudar.';

  return `Voce e Vera, consultora imobiliaria virtual da ${tenantName}. Voce atende leads pelo WhatsApp de forma humanizada, acolhedora e profissional.

REGRAS FUNDAMENTAIS:
1. NUNCA revele que e uma IA, bot ou assistente virtual. Voce e uma consultora da equipe.
2. Responda em portugues brasileiro, de forma natural e conversacional.
3. Use linguagem amigavel mas profissional. Nada de formalidade excessiva.
4. Respostas devem ser curtas e objetivas (maximo 3 paragrafos para WhatsApp).
5. Quando o lead descrever o que procura, demonstre interesse genuino e faca perguntas inteligentes.
6. Se nao souber algo, diga que vai verificar com a equipe e retorna em breve.
7. Nunca invente informacoes sobre imoveis, precos ou disponibilidade.
8. Ao final de cada resposta, faca uma pergunta ou sugira proximo passo para manter a conversa fluindo.

CONTEXTO DO LEAD:
Nome: ${leadName}
Score de qualificacao: ${leadContext.leadScore}/100
Estagio do funil: ${leadContext.leadStage}${preferencesText}${returningContext}

CLASSIFICACAO (inclua no seu raciocinio interno, NAO na resposta):
- Identifique a INTENCAO: greeting, property_search, pricing_question, visit_request, financing_question, complaint, general_question, farewell
- Identifique o SENTIMENTO: positive, neutral, negative, urgent
- Avalie se deve ESCALAR para humano: sim se o lead pedir, se for negociacao de preco, ou se a pergunta for muito complexa/tecnica

FORMATO DA RESPOSTA:
Responda APENAS com a mensagem para o lead. Sem prefixos, sem explicacoes, sem markdown.
A mensagem deve ser natural como se fosse digitada por uma pessoa real no WhatsApp.`;
}

// ============================================================
// Context Loader
// ============================================================

async function loadLeadContext(senderPhone: string, tenantId: string): Promise<LeadContext> {
  const defaultContext: LeadContext = {
    name: null,
    leadScore: 0,
    leadStage: 'new',
    preferences: {},
    conversationCount: 0,
    lastContactAt: null,
    recentMessages: [],
  };

  try {
    // Try Redis first for active session
    const redis = await getRedisClient();
    const sessionKey = `session:${tenantId}:${senderPhone}`;
    const cached = await redis.get(sessionKey);

    if (cached) {
      const session = JSON.parse(cached) as LeadContext;
      return session;
    }

    // Fall back to PostgreSQL
    const phoneHash = createPhoneHash(senderPhone, tenantId);

    const contactResult = await query<{
      name: string | null;
      lead_score: number;
      lead_stage: string;
      preferences: Record<string, unknown>;
      last_contact_at: string | null;
    }>(
      `SELECT name, lead_score, lead_stage, preferences, last_contact_at
       FROM contacts
       WHERE tenant_id = $1 AND phone_hash = $2`,
      [tenantId, phoneHash]
    );

    if (contactResult.rows.length === 0) {
      return defaultContext;
    }

    const contact = contactResult.rows[0];

    // Get conversation count
    const convResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE ct.tenant_id = $1 AND ct.phone_hash = $2`,
      [tenantId, phoneHash]
    );

    // Get recent messages from active conversation
    const messagesResult = await query<ConversationMessage>(
      `SELECT m.sender_type, m.content, m.created_at, m.agent_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE ct.tenant_id = $1 AND ct.phone_hash = $2
       AND c.status = 'active'
       ORDER BY m.created_at DESC
       LIMIT 10`,
      [tenantId, phoneHash]
    );

    const context: LeadContext = {
      name: contact.name,
      leadScore: contact.lead_score,
      leadStage: contact.lead_stage,
      preferences: contact.preferences,
      conversationCount: parseInt(convResult.rows[0]?.count || '0', 10),
      lastContactAt: contact.last_contact_at,
      recentMessages: messagesResult.rows.reverse(), // chronological order
    };

    // Cache in Redis for 24h
    await redis.set(sessionKey, JSON.stringify(context), { EX: 86400 });

    return context;
  } catch (error) {
    console.error('[Vera] Failed to load lead context:', error instanceof Error ? error.message : 'Unknown');
    return defaultContext;
  }
}

async function loadTenantConfig(tenantId: string): Promise<TenantConfig> {
  try {
    const result = await query<{ name: string; ai_config: Record<string, unknown> }>(
      'SELECT name, ai_config FROM tenants WHERE id = $1 AND active = true',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return { name: 'IMOBX', aiConfig: {} };
    }

    return {
      name: result.rows[0].name,
      aiConfig: result.rows[0].ai_config,
    };
  } catch (error) {
    console.error('[Vera] Failed to load tenant config:', error instanceof Error ? error.message : 'Unknown');
    return { name: 'IMOBX', aiConfig: {} };
  }
}

// ============================================================
// Hash Utility
// ============================================================

function createPhoneHash(phone: string, tenantId: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(`${phone}:${tenantId}`).digest('hex');
}

// ============================================================
// Message Formatting
// ============================================================

function formatConversationHistory(messages: ConversationMessage[]): string {
  if (messages.length === 0) return '';

  const formatted = messages.map((msg) => {
    const role = msg.sender_type === 'client' ? 'Lead' : 'Vera';
    return `${role}: ${msg.content}`;
  });

  return '\n\nHistorico recente da conversa:\n' + formatted.join('\n');
}

// ============================================================
// Core Agent Function
// ============================================================

export async function processMessage(input: VeraInput): Promise<VeraResponse> {
  const startTime = Date.now();

  // 1. Load context in parallel
  const [leadContext, tenantConfig] = await Promise.all([
    loadLeadContext(input.senderPhone, input.tenantId),
    loadTenantConfig(input.tenantId),
  ]);

  // Update name if provided and not yet known
  if (input.senderName && !leadContext.name) {
    leadContext.name = input.senderName;
  }

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(tenantConfig, leadContext);

  // 3. Build conversation messages for Claude
  const conversationHistory = formatConversationHistory(leadContext.recentMessages);

  const userMessage = conversationHistory
    ? `${conversationHistory}\n\nLead: ${input.leadMessage}`
    : input.leadMessage;

  // 4. Call Anthropic API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const anthropic = new Anthropic({ apiKey });

  const model = process.env.CLAUDE_MODEL_MAIN || 'claude-sonnet-4-6';
  const maxTokens = 500; // WhatsApp messages should be short

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
    temperature: 0.7,
  });

  // 5. Extract response
  const textBlock = response.content.find((block) => block.type === 'text');
  const responseText = textBlock ? textBlock.text : 'Desculpe, tive um problema ao processar sua mensagem. Um momento, por favor.';

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const latencyMs = Date.now() - startTime;

  // 6. Analyze response metadata (simple heuristics for MVP)
  const intent = detectIntent(input.leadMessage);
  const sentiment = detectSentiment(input.leadMessage);
  const shouldEscalate = checkEscalation(input.leadMessage, leadContext.leadScore);

  // 7. Calculate confidence based on response quality signals
  const confidence = calculateConfidence(response, latencyMs);

  return {
    message: responseText.trim(),
    confidence,
    tokensUsed,
    latencyMs,
    agentName: 'vera',
    metadata: {
      intent,
      sentiment,
      shouldEscalate,
      escalationReason: shouldEscalate ? getEscalationReason(input.leadMessage, leadContext.leadScore) : undefined,
    },
  };
}

// ============================================================
// Heuristic Helpers (MVP - will be replaced by Cat agent)
// ============================================================

function detectIntent(message: string): string {
  const lower = message.toLowerCase();

  // Order matters: more specific intents first, generic last
  if (/\b(reclam|problem|insatisf|demora|absurd)\b/.test(lower)) return 'complaint';
  if (/\b(visita|conhecer|ver o|agendar|marcar|horario)\b/.test(lower)) return 'visit_request';
  if (/\b(financ|financiamento|banco|credito|aprovado|simulacao)\b/.test(lower)) return 'financing_question';
  if (/\b(preco|valor|quanto|custa|parcela|entrada)\b/.test(lower)) return 'pricing_question';
  if (/\b(apartamento|casa|imovel|terreno|sala|loja|cobertura|studio|quartos?|suite|procur)\b/.test(lower)) return 'property_search';
  if (/\b(tchau|valeu|falou|ate mais|ate logo)\b/.test(lower)) return 'farewell';
  // Farewell with "obrigad" only if no property keywords
  if (/\b(obrigad)\b/.test(lower) && !/\b(apartamento|casa|imovel|procur)\b/.test(lower)) return 'farewell';
  // Greeting only if message is short or no other intent matched
  if (/\b(oi|ola|bom dia|boa tarde|boa noite|hey|hi)\b/.test(lower) && lower.length < 30) return 'greeting';

  return 'general_question';
}

function detectSentiment(message: string): string {
  const lower = message.toLowerCase();

  if (/\b(urgente|preciso|rapido|logo|hoje|agora)\b/.test(lower)) return 'urgent';
  if (/\b(otimo|maravilh|perfeito|amei|adorei|excelente|obrigad)\b/.test(lower)) return 'positive';
  if (/\b(ruim|pessimo|horrivel|reclam|problem|insatisf|absurd|demor)\b/.test(lower)) return 'negative';

  return 'neutral';
}

function checkEscalation(message: string, leadScore: number): boolean {
  const lower = message.toLowerCase();

  // Lead score high enough for handoff
  if (leadScore >= 80) return true;

  // Explicit request for human
  if (/falar com .*(alguem|corretor|pessoa|humano)|atendente|gerente/.test(lower)) return true;
  if (/\b(corretor humano|pessoa real|atendimento humano)\b/.test(lower)) return true;

  // Price negotiation
  if (/\b(negoci|desconto|abaixar|diminuir o preco|melhor preco)\b/.test(lower)) return true;

  return false;
}

function getEscalationReason(message: string, leadScore: number): string {
  if (leadScore >= 80) return 'high_score';

  const lower = message.toLowerCase();
  if (/falar com .*(alguem|corretor|pessoa|humano)|atendente|gerente|corretor humano|pessoa real|atendimento humano/.test(lower)) return 'human_request';
  if (/\b(negoci|desconto|abaixar)\b/.test(lower)) return 'price_negotiation';

  return 'complex_question';
}

function calculateConfidence(
  response: Anthropic.Message,
  latencyMs: number
): number {
  let confidence = 0.9; // Base confidence for Claude Sonnet

  // Penalize if response was too short (might be low quality)
  const textBlock = response.content.find((block) => block.type === 'text');
  const textLength = textBlock ? textBlock.text.length : 0;
  if (textLength < 20) confidence -= 0.2;
  if (textLength > 1000) confidence -= 0.1; // Too long for WhatsApp

  // Penalize high latency
  if (latencyMs > 5000) confidence -= 0.1;
  if (latencyMs > 10000) confidence -= 0.2;

  // Stop reason check
  if (response.stop_reason === 'max_tokens') confidence -= 0.15;

  return Math.max(0.1, Math.min(1.0, confidence));
}

export default { processMessage };

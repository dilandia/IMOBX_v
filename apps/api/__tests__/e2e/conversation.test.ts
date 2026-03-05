/**
 * E2E Tests - Full Conversation Flow
 *
 * Tests the complete pipeline:
 * 1. Mock webhook --> Vera processes message --> Response generated
 * 2. Response time < 5s
 * 3. No message duplication
 * 4. Confidence score > 0.8
 *
 * Note: Uses mocked external services (Anthropic, DB, Redis)
 * For full integration with testcontainers, these mocks would be replaced
 * with real Redis/PostgreSQL containers.
 */

// Mock external services
jest.mock('../../src/services/database', () => ({
  query: jest.fn().mockResolvedValue({
    rows: [],
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    fields: [],
  }),
}));

jest.mock('../../src/services/redis', () => {
  // In-memory dedup store for realistic behavior
  const dedupStore = new Map<string, string>();

  return {
    getRedisClient: jest.fn().mockResolvedValue({
      get: jest.fn().mockImplementation(async (key: string) => {
        return dedupStore.get(key) || null;
      }),
      set: jest.fn().mockImplementation(async (key: string, value: string, options?: { NX?: boolean; EX?: number }) => {
        if (options?.NX && dedupStore.has(key)) {
          return null; // Key exists = duplicate
        }
        dedupStore.set(key, value);
        if (options?.EX) {
          setTimeout(() => dedupStore.delete(key), options.EX * 1000);
        }
        return 'OK';
      }),
    }),
    closeRedisClient: jest.fn(),
    __resetDedupStore: () => dedupStore.clear(),
  };
});

jest.mock('../../src/services/queue', () => ({
  publishMessage: jest.fn().mockResolvedValue('job-123'),
  getMessageQueue: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
  closeQueue: jest.fn(),
}));

const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockAnthropicCreate,
    },
  }));
});

import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { registerWebhookRoutes } from '../../src/routes/webhook';
import { processMessage, VeraInput } from '../../src/agents/vera';
import { publishMessage } from '../../src/services/queue';

const WEBHOOK_SECRET = 'e2e-test-secret';

function createSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildWebhookPayload(text: string, messageId?: string) {
  return {
    event: 'messages.upsert',
    instance: 'imobx-prod',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
        id: messageId || `e2e-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      pushName: 'Lead Teste',
      message: {
        conversation: text,
      },
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}

describe('E2E: Complete Conversation Flow', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.ANTHROPIC_API_KEY = 'e2e-test-key';
    process.env.CLAUDE_MODEL_MAIN = 'claude-sonnet-4-6';
    process.env.DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

    server = Fastify({ logger: false });
    await registerWebhookRoutes(server);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset dedup store
    const redisMock = jest.requireMock('../../src/services/redis') as { __resetDedupStore: () => void };
    redisMock.__resetDedupStore();

    // Default Anthropic mock response
    mockAnthropicCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Ola! Que bom receber voce aqui. Estou a disposicao para ajudar na sua busca por imoveis. Pode me contar mais sobre o que esta procurando? Tipo de imovel, regiao, numero de quartos?',
        },
      ],
      usage: { input_tokens: 200, output_tokens: 45 },
      stop_reason: 'end_turn',
    });
  });

  // ============================================================
  // Flow 1: Webhook receives message -> Queue -> Vera responds
  // ============================================================
  describe('Flow: Webhook -> Vera Agent', () => {
    it('should receive webhook and queue message for processing', async () => {
      const payload = buildWebhookPayload('Oi, estou procurando um apartamento');
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('received');
      expect(publishMessage).toHaveBeenCalledTimes(1);
    });

    it('should process message through Vera and get humanized response', async () => {
      const input: VeraInput = {
        leadMessage: 'Oi, estou procurando um apartamento de 3 quartos no Jardins',
        senderPhone: '5511999999999',
        senderName: 'Marcos',
        tenantId: '00000000-0000-0000-0000-000000000001',
      };

      const response = await processMessage(input);

      expect(response).toBeDefined();
      expect(response.message).toBeTruthy();
      expect(response.agentName).toBe('vera');
      expect(response.message.length).toBeGreaterThan(20);

      // Should NOT contain bot-like markers
      expect(response.message).not.toMatch(/\[.*\]/); // No bracket markers
      expect(response.message).not.toMatch(/^(Bot|AI|Assistente):/i);
    });
  });

  // ============================================================
  // Flow 2: Response Time < 5s
  // ============================================================
  describe('Performance: Response Time', () => {
    it('should process Vera response in under 5 seconds (P95 target)', async () => {
      const input: VeraInput = {
        leadMessage: 'Quero um apartamento de 2 quartos ate 500 mil reais',
        senderPhone: '5511888888888',
        senderName: 'Julia',
        tenantId: '00000000-0000-0000-0000-000000000001',
      };

      const startTime = Date.now();
      const response = await processMessage(input);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(5000);
      expect(response.latencyMs).toBeLessThan(5000);
    });

    it('should acknowledge webhook within 100ms', async () => {
      const payload = buildWebhookPayload('Mensagem rapida');
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      const start = Date.now();
      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });
      const elapsed = Date.now() - start;

      expect(response.statusCode).toBe(200);
      expect(elapsed).toBeLessThan(100);
    });
  });

  // ============================================================
  // Flow 3: No Message Duplication
  // ============================================================
  describe('Dedup: No Duplicate Processing', () => {
    it('should process first message and skip duplicate', async () => {
      const messageId = 'dedup-test-msg-001';
      const payload = buildWebhookPayload('Primeira mensagem', messageId);
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      // First request: should be processed
      const response1 = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      expect(response1.json().status).toBe('received');
      expect(publishMessage).toHaveBeenCalledTimes(1);

      // Second request with same messageId: should be deduplicated
      const response2 = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      expect(response2.json().status).toBe('duplicate');
      // publishMessage should still be called only once (from first request)
      expect(publishMessage).toHaveBeenCalledTimes(1);
    });

    it('should allow different message IDs', async () => {
      const payload1 = buildWebhookPayload('Mensagem 1', 'unique-msg-001');
      const body1 = JSON.stringify(payload1);
      const sig1 = createSignature(body1, WEBHOOK_SECRET);

      const payload2 = buildWebhookPayload('Mensagem 2', 'unique-msg-002');
      const body2 = JSON.stringify(payload2);
      const sig2 = createSignature(body2, WEBHOOK_SECRET);

      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: { 'content-type': 'application/json', 'x-webhook-signature': sig1 },
        payload: body1,
      });

      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: { 'content-type': 'application/json', 'x-webhook-signature': sig2 },
        payload: body2,
      });

      // Both should be published (different message IDs)
      expect(publishMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // Flow 4: Confidence Score > 0.8
  // ============================================================
  describe('Quality: Confidence Score', () => {
    it('should return confidence > 0.8 for standard interactions', async () => {
      const inputs: VeraInput[] = [
        {
          leadMessage: 'Oi, bom dia!',
          senderPhone: '5511999999999',
          senderName: 'Ana',
          tenantId: '00000000-0000-0000-0000-000000000001',
        },
        {
          leadMessage: 'Procuro casa 4 quartos em Alphaville',
          senderPhone: '5511888888888',
          senderName: 'Pedro',
          tenantId: '00000000-0000-0000-0000-000000000001',
        },
        {
          leadMessage: 'Quanto custa o apartamento do anuncio?',
          senderPhone: '5511777777777',
          senderName: 'Maria',
          tenantId: '00000000-0000-0000-0000-000000000001',
        },
      ];

      for (const input of inputs) {
        const response = await processMessage(input);
        expect(response.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should penalize confidence for very short responses', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Ok.' }],
        usage: { input_tokens: 100, output_tokens: 2 },
        stop_reason: 'end_turn',
      });

      const input: VeraInput = {
        leadMessage: 'Oi',
        senderPhone: '5511999999999',
        senderName: 'Test',
        tenantId: '00000000-0000-0000-0000-000000000001',
      };

      const response = await processMessage(input);
      expect(response.confidence).toBeLessThan(0.9);
    });

    it('should penalize confidence for max_tokens cutoff', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Resposta cortada no meio da frase porque o limite de tokens...' }],
        usage: { input_tokens: 100, output_tokens: 500 },
        stop_reason: 'max_tokens',
      });

      const input: VeraInput = {
        leadMessage: 'Conte tudo sobre imoveis',
        senderPhone: '5511999999999',
        senderName: 'Test',
        tenantId: '00000000-0000-0000-0000-000000000001',
      };

      const response = await processMessage(input);
      expect(response.confidence).toBeLessThan(0.85);
    });
  });

  // ============================================================
  // Flow 5: Multi-step Conversation
  // ============================================================
  describe('Conversation: Multi-step Flow', () => {
    it('should handle a sequence of messages from same lead', async () => {
      const phone = '5511999999999';
      const tenantId = '00000000-0000-0000-0000-000000000001';

      const messages = [
        'Oi, bom dia!',
        'Estou procurando um apartamento de 2 quartos',
        'Preferencia na zona sul de SP, ate 600 mil',
      ];

      const responses: Array<{ message: string; confidence: number; intent: string }> = [];

      for (const msg of messages) {
        mockAnthropicCreate.mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: `Resposta contextualizada para: ${msg}`,
            },
          ],
          usage: { input_tokens: 150 + responses.length * 50, output_tokens: 40 },
          stop_reason: 'end_turn',
        });

        const response = await processMessage({
          leadMessage: msg,
          senderPhone: phone,
          senderName: 'Lead Multi',
          tenantId,
        });

        responses.push({
          message: response.message,
          confidence: response.confidence,
          intent: response.metadata.intent,
        });
      }

      // All responses should be valid
      expect(responses).toHaveLength(3);
      responses.forEach((r) => {
        expect(r.message).toBeTruthy();
        expect(r.confidence).toBeGreaterThan(0.5);
      });
    });
  });

  // ============================================================
  // Flow 6: Error Resilience
  // ============================================================
  describe('Resilience: Error Handling', () => {
    it('should handle Anthropic API failure gracefully', async () => {
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API rate limited'));

      const input: VeraInput = {
        leadMessage: 'Mensagem durante falha',
        senderPhone: '5511999999999',
        senderName: 'Test',
        tenantId: '00000000-0000-0000-0000-000000000001',
      };

      await expect(processMessage(input)).rejects.toThrow();
    });

    it('should still acknowledge webhook even on internal errors', async () => {
      // Queue publishing fails
      (publishMessage as jest.Mock).mockRejectedValueOnce(new Error('Queue connection lost'));

      const payload = buildWebhookPayload('Mensagem durante falha de fila');
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      // Should still return 200 to prevent retry flood
      expect(response.statusCode).toBe(200);
    });
  });

  // ============================================================
  // Flow 7: Security
  // ============================================================
  describe('Security: Webhook Validation', () => {
    it('should reject tampered payloads', async () => {
      const payload = buildWebhookPayload('Original message');
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      // Tamper with the body after signing
      const tamperedBody = body.replace('Original message', 'Hacked message');

      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: tamperedBody,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

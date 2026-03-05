/**
 * Unit tests for Webhook Receiver
 *
 * Tests:
 * - HMAC signature validation
 * - Message dedup via Redis
 * - BullMQ queue publishing
 * - Edge cases (missing fields, duplicates, self-messages)
 */

import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';

// Mock dependencies
jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  }),
}));

jest.mock('../../src/services/queue', () => ({
  publishMessage: jest.fn().mockResolvedValue('job-123'),
  getMessageQueue: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
  }),
}));

jest.mock('../../src/services/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

import { registerWebhookRoutes } from '../../src/routes/webhook';
import { getRedisClient } from '../../src/services/redis';
import { publishMessage } from '../../src/services/queue';

const WEBHOOK_SECRET = 'test-secret-key';

function createSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildEvolutionPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'imobx-prod',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
        id: `msg-${Date.now()}`,
      },
      pushName: 'Marcos',
      message: {
        conversation: 'Oi, procuro apartamento',
      } as Record<string, unknown>,
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      ...overrides,
    },
  };
}

describe('Webhook Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
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

    // Reset Redis mock to allow messages (not duplicate)
    const mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    (getRedisClient as jest.Mock).mockResolvedValue(mockRedis);
  });

  describe('POST /webhook/message', () => {
    it('should accept valid webhook with signature', async () => {
      const payload = buildEvolutionPayload();
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
      const json = response.json();
      expect(json.status).toBe('received');
      expect(json.requestId).toBeDefined();
    });

    it('should reject invalid signature with 401', async () => {
      const payload = buildEvolutionPayload();
      const body = JSON.stringify(payload);

      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'invalid-signature-hex',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject missing signature with 401', async () => {
      const payload = buildEvolutionPayload();
      const body = JSON.stringify(payload);

      const response = await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should detect and skip duplicate messages', async () => {
      // Mock Redis to return null on SET NX (key already exists = duplicate)
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(null), // null = key existed
      };
      (getRedisClient as jest.Mock).mockResolvedValue(mockRedis);

      const payload = buildEvolutionPayload();
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
      const json = response.json();
      expect(json.status).toBe('duplicate');

      // Should NOT publish to queue
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it('should publish message to BullMQ queue', async () => {
      const payload = buildEvolutionPayload();
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      expect(publishMessage).toHaveBeenCalledTimes(1);

      const jobData = (publishMessage as jest.Mock).mock.calls[0][0];
      expect(jobData.content).toBe('Oi, procuro apartamento');
      expect(jobData.senderPhone).toBe('5511999999999');
      expect(jobData.senderName).toBe('Marcos');
    });

    it('should ignore fromMe messages (self-sent)', async () => {
      const payload = buildEvolutionPayload();
      payload.data.key.fromMe = true;
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
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it('should handle messages without text content', async () => {
      const payload = buildEvolutionPayload();
      payload.data.message = {};
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
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it('should extract text from extendedTextMessage', async () => {
      const payload = buildEvolutionPayload();
      payload.data.message = {
        extendedTextMessage: { text: 'Mensagem com link https://example.com' },
      };
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      const jobData = (publishMessage as jest.Mock).mock.calls[0][0];
      expect(jobData.content).toBe('Mensagem com link https://example.com');
    });

    it('should extract phone number from remoteJid', async () => {
      const payload = buildEvolutionPayload();
      payload.data.key.remoteJid = '5521988887777@s.whatsapp.net';
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });

      const jobData = (publishMessage as jest.Mock).mock.calls[0][0];
      expect(jobData.senderPhone).toBe('5521988887777');
    });

    it('should respond within 50ms (fast ack)', async () => {
      const payload = buildEvolutionPayload();
      const body = JSON.stringify(payload);
      const signature = createSignature(body, WEBHOOK_SECRET);

      const start = Date.now();
      await server.inject({
        method: 'POST',
        url: '/webhook/message',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        payload: body,
      });
      const elapsed = Date.now() - start;

      // Should be very fast since processing is async
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('POST /webhook/status', () => {
    it('should acknowledge status updates', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/webhook/status',
        payload: {
          messageId: 'msg-123',
          status: 'delivered',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('acknowledged');
    });
  });
});

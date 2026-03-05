/**
 * Webhook Receiver - POST /webhook/message
 *
 * Responsabilidades:
 * 1. Receber mensagens da Evolution API
 * 2. Validar assinatura HMAC do webhook
 * 3. Dedup por message_id via Redis cache (5min TTL)
 * 4. Publicar na fila BullMQ 'imobx:messages'
 * 5. Responder 200 imediatamente (async processing)
 * 6. Logging estruturado com request IDs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getRedisClient } from '../services/redis';
import { publishMessage, IncomingMessageJob } from '../services/queue';

// ============================================================
// Types
// ============================================================

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
      };
      imageMessage?: {
        caption?: string;
        url?: string;
      };
      audioMessage?: {
        url?: string;
      };
    };
    messageType: string;
    messageTimestamp: number;
  };
}

interface WebhookResponse {
  status: 'received' | 'duplicate' | 'error';
  messageId?: string;
  requestId: string;
  timestamp: string;
}

// ============================================================
// HMAC Signature Validation
// ============================================================

function validateSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

// ============================================================
// Message Text Extraction
// ============================================================

function extractMessageText(data: EvolutionWebhookPayload['data']): string | null {
  const msg = data.message;
  if (!msg) return null;

  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;

  return null;
}

function extractMediaInfo(data: EvolutionWebhookPayload['data']): { type: string | null; url: string | null } {
  const msg = data.message;
  if (!msg) return { type: null, url: null };

  if (msg.imageMessage) return { type: 'image', url: msg.imageMessage.url || null };
  if (msg.audioMessage) return { type: 'audio', url: msg.audioMessage.url || null };

  return { type: null, url: null };
}

function extractPhoneNumber(remoteJid: string): string {
  // Evolution API format: 5511999999999@s.whatsapp.net
  return remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

// ============================================================
// Route Registration
// ============================================================

export async function registerWebhookRoutes(server: FastifyInstance) {
  /**
   * POST /webhook/message
   * Receive messages from Evolution API
   *
   * Flow:
   * 1. Generate request ID for tracing
   * 2. Validate HMAC signature
   * 3. Check dedup cache (Redis, 5min TTL)
   * 4. Publish to BullMQ queue
   * 5. Return 200 immediately
   */
  server.post(
    '/webhook/message',
    {
      config: {
        rawBody: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = uuidv4();
      const receivedAt = Date.now();

      try {
        const rawBody = typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);

        // 1. Validate HMAC signature
        const webhookSecret = process.env.WEBHOOK_SECRET;
        if (webhookSecret) {
          const signature = request.headers['x-webhook-signature'] as string | undefined
            || request.headers['x-signature'] as string | undefined;

          if (!validateSignature(rawBody, signature, webhookSecret)) {
            server.log.warn({
              requestId,
              event: 'webhook.signature_invalid',
              ip: request.ip,
            });

            return reply.status(401).send({
              status: 'error',
              requestId,
              timestamp: new Date().toISOString(),
            } satisfies WebhookResponse);
          }
        }

        // 2. Parse payload
        const payload = (typeof request.body === 'string'
          ? JSON.parse(request.body)
          : request.body) as EvolutionWebhookPayload;

        // Ignore non-message events and self-sent messages
        if (!payload.data || payload.data.key.fromMe) {
          return reply.send({
            status: 'received',
            requestId,
            timestamp: new Date().toISOString(),
          });
        }

        const messageId = payload.data.key.id;
        const messageText = extractMessageText(payload.data);

        // Skip messages without text content (for now)
        if (!messageText) {
          server.log.info({
            requestId,
            event: 'webhook.no_text_content',
            messageType: payload.data.messageType,
          });

          return reply.send({
            status: 'received',
            messageId,
            requestId,
            timestamp: new Date().toISOString(),
          });
        }

        // 3. Dedup check via Redis (5min TTL)
        const isDuplicate = await checkDuplicate(messageId);
        if (isDuplicate) {
          server.log.info({
            requestId,
            event: 'webhook.duplicate',
            messageId,
          });

          return reply.send({
            status: 'duplicate',
            messageId,
            requestId,
            timestamp: new Date().toISOString(),
          });
        }

        // 4. Extract message data
        const senderPhone = extractPhoneNumber(payload.data.key.remoteJid);
        const senderName = payload.data.pushName || 'Unknown';
        const media = extractMediaInfo(payload.data);

        // Resolve tenant from instance (MVP: single tenant mapping)
        const tenantId = await resolveTenantId(payload.instance);

        // 5. Publish to BullMQ queue
        const jobData: IncomingMessageJob = {
          messageId,
          tenantId,
          senderPhone,
          senderName,
          content: messageText,
          mediaType: media.type,
          mediaUrl: media.url,
          timestamp: payload.data.messageTimestamp,
          receivedAt,
        };

        const jobId = await publishMessage(jobData);

        server.log.info({
          requestId,
          event: 'webhook.queued',
          messageId,
          jobId,
          senderPhone: maskPhone(senderPhone),
          contentLength: messageText.length,
          latencyMs: Date.now() - receivedAt,
        });

        // 6. Return 200 immediately
        return reply.send({
          status: 'received',
          messageId,
          requestId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        server.log.error({
          requestId,
          event: 'webhook.error',
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });

        // Still return 200 to prevent Evolution API retries flooding
        return reply.status(200).send({
          status: 'error',
          requestId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * POST /webhook/status
   * Receive message delivery status from Evolution API
   */
  server.post(
    '/webhook/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = uuidv4();

      try {
        const body = request.body as { messageId?: string; status?: string };

        server.log.info({
          requestId,
          event: 'webhook.status_update',
          messageId: body.messageId,
          deliveryStatus: body.status,
        });

        return reply.send({ status: 'acknowledged', requestId });
      } catch (error) {
        server.log.error({
          requestId,
          event: 'webhook.status_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return reply.status(200).send({ status: 'error', requestId });
      }
    }
  );
}

// ============================================================
// Helper Functions
// ============================================================

async function checkDuplicate(messageId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const dedupKey = `dedup:msg:${messageId}`;

    // SET NX with 5 minute TTL - returns null if key already exists
    const result = await redis.set(dedupKey, '1', { NX: true, EX: 300 });
    return result === null; // null means key existed = duplicate
  } catch (error) {
    // If Redis is down, allow message through (fail open)
    console.error('[Webhook] Redis dedup check failed:', error instanceof Error ? error.message : 'Unknown');
    return false;
  }
}

async function resolveTenantId(instanceName: string): Promise<string> {
  // MVP: Map Evolution API instance to tenant
  // In production, this would query the tenants table
  try {
    const { query: dbQuery } = await import('../services/database');
    const result = await dbQuery<{ id: string }>(
      `SELECT id FROM tenants WHERE evolution_config->>'instanceName' = $1 AND active = true LIMIT 1`,
      [instanceName]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
  } catch {
    // Fall through to default
  }

  // Fallback: use a default tenant ID for MVP
  return process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
}

function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return '***' + phone.slice(-4);
}

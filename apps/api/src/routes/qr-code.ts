import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface QRCodeResponse {
  qrcode?: string;
  base64Image?: string;
  status?: string;
  instance?: string;
}

interface APIResponse {
  status: string;
  qrcode?: string | null;
  base64?: string | null;
  instanceStatus?: string;
  timestamp: string;
  error?: string;
}

export async function registerQRCodeRoutes(server: FastifyInstance) {
  /**
   * GET /qr-code
   * Fetch QR code from Evolution API for WhatsApp connection
   */
  server.get<{ Querystring: { instance?: string } }>(
    '/qr-code',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
        const API_KEY = process.env.EVOLUTION_API_KEY || 'imobx_evolution_2026';
        const INSTANCE_NAME = request.query.instance || 'imobx-prod';

        const connectUrl = `${EVOLUTION_URL}/instance/connect/${INSTANCE_NAME}`;

        server.log.info(`Fetching QR code from: ${connectUrl}`);

        const response = await fetch(connectUrl, {
          method: 'GET',
          headers: {
            'apikey': API_KEY,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          return reply.status(response.status).send<APIResponse>({
            status: 'error',
            error: `Evolution API responded with ${response.status}`,
            timestamp: new Date().toISOString(),
          });
        }

        const data = (await response.json()) as QRCodeResponse;

        const result: APIResponse = {
          status: 'ok',
          qrcode: data.qrcode || null,
          base64: data.base64Image || null,
          instanceStatus: data.status || 'unknown',
          timestamp: new Date().toISOString(),
        };

        // Log QR code generation for debugging
        server.log.info(`QR code generated for instance: ${INSTANCE_NAME}`);

        return reply.send(result);
      } catch (error) {
        server.log.error(error);
        return reply.status(500).send<APIResponse>({
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to generate QR code',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * POST /qr-code/refresh
   * Manually trigger QR code refresh
   */
  server.post<{ Body: { instance?: string } }>(
    '/qr-code/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
        const API_KEY = process.env.EVOLUTION_API_KEY || 'imobx_evolution_2026';
        const INSTANCE_NAME = request.body?.instance || 'imobx-prod';

        const refreshUrl = `${EVOLUTION_URL}/instance/restart/${INSTANCE_NAME}`;

        server.log.info(`Refreshing QR code for instance: ${INSTANCE_NAME}`);

        const response = await fetch(refreshUrl, {
          method: 'POST',
          headers: {
            'apikey': API_KEY,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          return reply.status(response.status).send<APIResponse>({
            status: 'error',
            error: `Failed to refresh QR code`,
            timestamp: new Date().toISOString(),
          });
        }

        // Fetch the new QR code
        const connectUrl = `${EVOLUTION_URL}/instance/connect/${INSTANCE_NAME}`;
        const qrResponse = await fetch(connectUrl, {
          method: 'GET',
          headers: {
            'apikey': API_KEY,
            'Content-Type': 'application/json',
          },
        });

        const data = (await qrResponse.json()) as QRCodeResponse;

        return reply.send<APIResponse>({
          status: 'ok',
          qrcode: data.qrcode || null,
          base64: data.base64Image || null,
          instanceStatus: data.status || 'unknown',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        server.log.error(error);
        return reply.status(500).send<APIResponse>({
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to refresh QR code',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
}

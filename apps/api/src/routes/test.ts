import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface TestMessageBody {
  phoneNumber: string;
  text: string;
  name?: string;
}

interface TestResponse {
  status: string;
  phoneNumber: string;
  message: string;
  latencyMs: number;
  timestamp: string;
}

export async function registerTestRoutes(server: FastifyInstance) {
  /**
   * POST /test/vera
   * Test Vera agent directly (for development/debugging)
   */
  server.post<{ Body: TestMessageBody }>(
    '/test/vera',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const startTime = Date.now();
        const { phoneNumber, text, name = 'Test User' } = request.body;

        server.log.info(`Test message from ${phoneNumber}: ${text}`);

        // TODO: Implement Vera agent call using Anthropic API
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) {
          return reply.status(500).send<TestResponse>({
            status: 'error',
            phoneNumber,
            message: 'ANTHROPIC_API_KEY not configured',
            latencyMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          });
        }

        // Placeholder response
        const responseMessage = `Olá ${name}! Esta é uma resposta de teste do agente Vera. Recebi sua mensagem: "${text}"`;

        const latencyMs = Date.now() - startTime;

        return reply.send<TestResponse>({
          status: 'ok',
          phoneNumber,
          message: responseMessage,
          latencyMs,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        server.log.error(error);
        return reply.status(500).send({
          status: 'error',
          message: error instanceof Error ? error.message : 'Test failed',
        });
      }
    }
  );

  /**
   * GET /test/status
   * Check system status (for debugging)
   */
  server.get('/test/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      services: {
        api: 'running',
        anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
        evolution: process.env.EVOLUTION_API_URL ? 'configured' : 'missing',
      },
      timestamp: new Date().toISOString(),
    });
  });
}

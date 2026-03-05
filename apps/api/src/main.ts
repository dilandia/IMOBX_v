import Fastify from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import dotenv from 'dotenv';
import { registerQRCodeRoutes } from './routes/qr-code';
import { registerWebhookRoutes } from './routes/webhook';
import { registerTestRoutes } from './routes/test';

dotenv.config();

const start = async () => {
  const fastify = Fastify({ logger: true });

  // Security middleware
  await fastify.register(fastifyHelmet);
  await fastify.register(fastifyCors, {
    origin: true,
  });

  // Serve static files (HTML, CSS, JS)
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
  });

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Register routes
  await registerQRCodeRoutes(fastify);
  await registerWebhookRoutes(fastify);
  await registerTestRoutes(fastify);

  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`✓ API running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

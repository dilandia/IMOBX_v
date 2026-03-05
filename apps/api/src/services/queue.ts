import { Queue, QueueOptions } from 'bullmq';

const QUEUE_NAME = 'imobx:messages';

let messageQueue: Queue | null = null;

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);

  return {
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
  };
}

export function getMessageQueue(): Queue {
  if (!messageQueue) {
    const connection = getRedisConnection();

    const options: QueueOptions = {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    };

    messageQueue = new Queue(QUEUE_NAME, options);
  }

  return messageQueue;
}

export interface IncomingMessageJob {
  messageId: string;
  tenantId: string;
  senderPhone: string;
  senderName: string;
  content: string;
  mediaType: string | null;
  mediaUrl: string | null;
  timestamp: number;
  receivedAt: number;
}

export async function publishMessage(data: IncomingMessageJob): Promise<string> {
  const queue = getMessageQueue();
  const job = await queue.add('incoming-message', data, {
    jobId: `msg:${data.messageId}`,
  });
  return job.id || data.messageId;
}

export async function closeQueue(): Promise<void> {
  if (messageQueue) {
    await messageQueue.close();
    messageQueue = null;
  }
}

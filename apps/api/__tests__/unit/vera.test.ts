/**
 * Unit tests for Vera Agent
 *
 * Tests:
 * - Message processing with mocked dependencies
 * - Response quality (confidence, latency)
 * - Intent detection heuristics
 * - Sentiment detection heuristics
 * - Escalation logic
 */

// Mock dependencies before importing
jest.mock('../../src/services/database', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  }),
}));

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Ola! Bem-vindo a nossa imobiliaria. Como posso ajudar voce hoje? Esta procurando algum tipo de imovel especifico?',
          },
        ],
        usage: { input_tokens: 150, output_tokens: 30 },
        stop_reason: 'end_turn',
      }),
    },
  }));
});

import { processMessage, VeraInput, VeraResponse } from '../../src/agents/vera';
import { query } from '../../src/services/database';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Vera Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-api-key';
    process.env.CLAUDE_MODEL_MAIN = 'claude-sonnet-4-6';

    // Default DB mock: no existing contact
    mockQuery.mockResolvedValue({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    });
  });

  const defaultInput: VeraInput = {
    leadMessage: 'Oi, estou procurando um apartamento de 2 quartos',
    senderPhone: '5511999999999',
    senderName: 'Marcos',
    tenantId: '00000000-0000-0000-0000-000000000001',
  };

  describe('processMessage', () => {
    it('should return a valid VeraResponse with message text', async () => {
      const response = await processMessage(defaultInput);

      expect(response).toBeDefined();
      expect(response.message).toBeTruthy();
      expect(typeof response.message).toBe('string');
      expect(response.message.length).toBeGreaterThan(10);
    });

    it('should return agentName as vera', async () => {
      const response = await processMessage(defaultInput);
      expect(response.agentName).toBe('vera');
    });

    it('should return confidence score between 0 and 1', async () => {
      const response = await processMessage(defaultInput);
      expect(response.confidence).toBeGreaterThanOrEqual(0.1);
      expect(response.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should return confidence > 0.8 for normal responses', async () => {
      const response = await processMessage(defaultInput);
      expect(response.confidence).toBeGreaterThan(0.8);
    });

    it('should track tokens used', async () => {
      const response = await processMessage(defaultInput);
      expect(response.tokensUsed).toBeGreaterThan(0);
    });

    it('should track latency in milliseconds', async () => {
      const response = await processMessage(defaultInput);
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect property_search intent', async () => {
      const response = await processMessage(defaultInput);
      expect(response.metadata.intent).toBe('property_search');
    });

    it('should throw error without ANTHROPIC_API_KEY', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(processMessage(defaultInput)).rejects.toThrow('ANTHROPIC_API_KEY not configured');
    });
  });

  describe('Intent Detection', () => {
    it('should detect greeting intent', async () => {
      const input = { ...defaultInput, leadMessage: 'Oi, bom dia!' };
      const response = await processMessage(input);
      expect(response.metadata.intent).toBe('greeting');
    });

    it('should detect pricing_question intent', async () => {
      const input = { ...defaultInput, leadMessage: 'Quanto custa esse apartamento?' };
      const response = await processMessage(input);
      expect(response.metadata.intent).toBe('pricing_question');
    });

    it('should detect visit_request intent', async () => {
      const input = { ...defaultInput, leadMessage: 'Quero agendar uma visita' };
      const response = await processMessage(input);
      expect(response.metadata.intent).toBe('visit_request');
    });

    it('should detect financing_question intent', async () => {
      const input = { ...defaultInput, leadMessage: 'Aceita financiamento bancario?' };
      const response = await processMessage(input);
      expect(response.metadata.intent).toBe('financing_question');
    });

    it('should detect farewell intent', async () => {
      const input = { ...defaultInput, leadMessage: 'Obrigado, ate mais!' };
      const response = await processMessage(input);
      expect(response.metadata.intent).toBe('farewell');
    });
  });

  describe('Sentiment Detection', () => {
    it('should detect neutral sentiment for plain messages', async () => {
      const input = { ...defaultInput, leadMessage: 'Quais imoveis tem disponiveis?' };
      const response = await processMessage(input);
      expect(response.metadata.sentiment).toBe('neutral');
    });

    it('should detect urgent sentiment', async () => {
      const input = { ...defaultInput, leadMessage: 'Preciso urgente de um apartamento' };
      const response = await processMessage(input);
      expect(response.metadata.sentiment).toBe('urgent');
    });

    it('should detect positive sentiment', async () => {
      const input = { ...defaultInput, leadMessage: 'Amei esse apartamento, obrigado!' };
      const response = await processMessage(input);
      expect(response.metadata.sentiment).toBe('positive');
    });

    it('should detect negative sentiment', async () => {
      const input = { ...defaultInput, leadMessage: 'O atendimento esta horrivel, demora demais' };
      const response = await processMessage(input);
      expect(response.metadata.sentiment).toBe('negative');
    });
  });

  describe('Escalation Logic', () => {
    it('should not escalate for normal messages', async () => {
      const response = await processMessage(defaultInput);
      expect(response.metadata.shouldEscalate).toBe(false);
    });

    it('should escalate when lead requests human', async () => {
      const input = { ...defaultInput, leadMessage: 'Quero falar com um corretor humano' };
      const response = await processMessage(input);
      expect(response.metadata.shouldEscalate).toBe(true);
      expect(response.metadata.escalationReason).toBe('human_request');
    });

    it('should escalate for price negotiation', async () => {
      const input = { ...defaultInput, leadMessage: 'Tem como negociar um desconto no preco?' };
      const response = await processMessage(input);
      expect(response.metadata.shouldEscalate).toBe(true);
      expect(response.metadata.escalationReason).toBe('price_negotiation');
    });
  });

  describe('Context Loading', () => {
    it('should handle missing contact gracefully', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      const response = await processMessage(defaultInput);
      expect(response.message).toBeTruthy();
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection refused'));

      const response = await processMessage(defaultInput);
      expect(response.message).toBeTruthy();
      // Should still work with default context
    });
  });
});

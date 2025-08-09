import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpTestClient, startTestServer } from './utils/httpClient';
import { E2E_CONFIG } from './config';
import { logger } from './utils/testLogger';
import { hasNylasCredentials } from './utils/config';

const SKIP_REAL_API = !hasNylasCredentials() || !process.env.OPENAI_API_KEY;
const realApiSuite = SKIP_REAL_API ? describe.skip : describe;

describe('A2A JSON-RPC Endpoint', () => {
    let client: HttpTestClient;
    let server: { port: number; stop: () => Promise<void> };

    beforeAll(async () => {
        logger.logSection('A2A RPC TEST INITIALIZATION');
        process.env.A2A_DEV_SHARED_SECRET = process.env.A2A_DEV_SHARED_SECRET || 'test-secret';
        server = await startTestServer();
        client = new HttpTestClient({
            baseUrl: 'http://localhost',
            port: server.port,
            devAgentSecret: process.env.A2A_DEV_SHARED_SECRET,
            credentials: {
                nylasGrantId: (E2E_CONFIG as any).nylas?.nylasGrantId
            }
        });
        logger.logSuccess(`Test server started on port ${server.port}`);
    }, 60000);

    afterAll(async () => {
        if (server) await server.stop();
    });

    test('should fail without valid auth', async () => {
        const unauthedClient = new HttpTestClient({
            baseUrl: 'http://localhost',
            port: server.port,
            devAgentSecret: 'wrong-secret'
        });
        const response = await unauthedClient.callRpc('agent.card');
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(401);
        expect(response.error.message).toBe('unauthorized_agent');
    });

    test('should respond to agent.card', async () => {
        const response = await client.callRpc('agent.card');
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
        expect(response.result.agent_id).toBe('inbox-mcp');
        expect(response.result.rpc.endpoint).toBe('/a2a/rpc');
        expect(Array.isArray(response.result.capabilities)).toBe(true);
    });

    test('should respond to agent.handshake with agent identity and card', async () => {
        const response = await client.callRpc('agent.handshake');
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
        expect(response.result.agent).toBeDefined();
        expect(response.result.card).toBeDefined();
        expect(response.result.card.rpc.endpoint).toBe('/a2a/rpc');
        expect(typeof response.result.server_time).toBe('string');
    });

    test('supports JSON-RPC batch with mixed requests', async () => {
        const id1 = '1';
        const id2 = '2';
        const batch = [
            { jsonrpc: '2.0', id: id1, method: 'agent.card' },
            { jsonrpc: '2.0', method: 'agent.card' } // notification (no id)
        ];
        const results = await client.callBatch(batch);
        // Should return only one response (for id1), notification yields no element
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(1);
        expect(results[0].id).toBe(id1);
        expect(results[0].result.rpc.endpoint).toBe('/a2a/rpc');
    });

    test('returns 204 for batch of only notifications', async () => {
        const batchOnlyNotifications = [
            { jsonrpc: '2.0', method: 'agent.card' },
            { jsonrpc: '2.0', method: 'agent.handshake' }
        ];
        const { status, data } = await client.callBatchRaw(batchOnlyNotifications);
        expect(status).toBe(204);
        expect(data).toBe('');
    });

    realApiSuite('Tool RPCs', () => {
        test('should return missing_credentials without EMAIL_ACCOUNT_GRANT', async () => {
            const response = await client.callRpc('tool.execute', {
                tool: 'find_emails',
                arguments: { query: 'test' }
            });
            expect(response.error).toBeDefined();
            expect(response.error.code).toBe(401);
            expect(response.error.message).toMatch(/missing_credentials/);
        });
    });
});



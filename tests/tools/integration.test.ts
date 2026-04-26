import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

let child: ChildProcess;
let stdout: string;
let responses: Map<number, any>;
let nextId: number;
let storePath: string;

function send(method: string, params: Record<string, unknown> = {}): number {
  const id = nextId++;
  child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return id;
}

function waitForResponse(id: number, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (responses.has(id)) {
        resolve(responses.get(id));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for response id=${id}`));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

beforeAll(async () => {
  storePath = await fs.mkdtemp(path.join(os.tmpdir(), 'contacts-mcp-integ-'));
  stdout = '';
  responses = new Map();
  nextId = 1;

  child = spawn('bun', ['dist/index.js'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, CONTACTS_MCP_STORE: storePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout!.on('data', (data: Buffer) => {
    stdout += data.toString();
    // Parse complete JSON-RPC messages
    const lines = stdout.split('\n');
    stdout = lines.pop() ?? ''; // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
          responses.set(msg.id, msg);
        }
      } catch { /* partial line */ }
    }
  });

  // Initialize
  const initId = send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration-test', version: '1.0' },
  });
  await waitForResponse(initId);
});

afterAll(async () => {
  child?.kill();
  await fs.rm(storePath, { recursive: true, force: true });
});

describe('MCP Integration', () => {
  it('should initialize with correct server info', async () => {
    const initResp = responses.get(1);
    expect(initResp.result.serverInfo.name).toBe('contacts-mcp');
    expect(initResp.result.serverInfo.version).toBe('0.1.0');
    expect(initResp.result.capabilities.tools).toBeTruthy();
    expect(initResp.result.capabilities.resources).toBeTruthy();
  });

  it('should list all 14 tools', async () => {
    const id = send('tools/list');
    const resp = await waitForResponse(id);

    const toolNames = resp.result.tools.map((t: any) => t.name);
    expect(toolNames).toHaveLength(14);
    expect(toolNames).toContain('search_contacts');
    expect(toolNames).toContain('get_contact');
    expect(toolNames).toContain('create_contact');
    expect(toolNames).toContain('update_contact');
    expect(toolNames).toContain('delete_contact');
    expect(toolNames).toContain('find_duplicates');
    expect(toolNames).toContain('merge_contacts');
    expect(toolNames).toContain('import_contacts');
    expect(toolNames).toContain('export_contacts');
    expect(toolNames).toContain('resolve_contact_points');
    expect(toolNames).toContain('sync_provider');
    expect(toolNames).toContain('list_providers');
    expect(toolNames).toContain('rollback');
    expect(toolNames).toContain('history');
  });

  it('should list resources', async () => {
    const id = send('resources/list');
    const resp = await waitForResponse(id);

    const uris = resp.result.resources.map((r: any) => r.uri);
    expect(uris).toContain('contacts://all');
    expect(uris).toContain('contacts://duplicates');
    expect(uris).toContain('contacts://history');
  });

  let createdId: string;

  it('should create a contact', async () => {
    const id = send('tools/call', {
      name: 'create_contact',
      arguments: {
        fullName: 'Integration Test User',
        givenName: 'Integration',
        familyName: 'User',
        emails: [{ value: 'integ@test.com', type: 'work' }],
        phones: [{ value: '(555) 000-1111', type: 'mobile' }],
        organization: { name: 'TestCo', title: 'Tester' },
      },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.fullName).toBe('Integration Test User');
    expect(result.id).toBeTruthy();
    expect(result.message).toContain('successfully');
    createdId = result.id;
  });

  it('should get the created contact', async () => {
    const id = send('tools/call', {
      name: 'get_contact',
      arguments: { id: createdId },
    });
    const resp = await waitForResponse(id);
    const contact = JSON.parse(resp.result.content[0].text);

    expect(contact.fullName).toBe('Integration Test User');
    expect(contact.emails[0].value).toBe('integ@test.com');
    expect(contact.phones[0].value).toBe('+15550001111'); // normalized
    expect(contact.organization.name).toBe('TestCo');
  });

  it('should search and find the contact', async () => {
    const id = send('tools/call', {
      name: 'search_contacts',
      arguments: { query: 'Integration' },
    });
    const resp = await waitForResponse(id);
    const results = JSON.parse(resp.result.content[0].text);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].fullName).toBe('Integration Test User');
  });

  it('should resolve contact points deterministically', async () => {
    const id = send('tools/call', {
      name: 'resolve_contact_points',
      arguments: { phones: ['555-000-1111'], emails: ['INTEG@TEST.COM'] },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('matched');
    expect(result.results[1].status).toBe('matched');
    expect(result.matched).toBe(2);
  });

  it('should expose sync-provider CLI help', async () => {
    const cli = spawn('bun', ['dist/index.js', '--help'], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, CONTACTS_MCP_STORE: storePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = await new Promise<string>((resolve, reject) => {
      let text = '';
      cli.stdout!.on('data', data => { text += data.toString(); });
      cli.on('error', reject);
      cli.on('close', code => {
        if (code === 0) resolve(text);
        else reject(new Error(`CLI exited with ${code}`));
      });
    });

    expect(output).toContain('sync-provider');
  });

  it('should update the contact', async () => {
    const id = send('tools/call', {
      name: 'update_contact',
      arguments: {
        id: createdId,
        notes: 'Updated via integration test',
      },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.message).toContain('successfully');

    // Verify the update
    const getId = send('tools/call', { name: 'get_contact', arguments: { id: createdId } });
    const getResp = await waitForResponse(getId);
    const contact = JSON.parse(getResp.result.content[0].text);
    expect(contact.notes).toBe('Updated via integration test');
  });

  it('should show history with create and update', async () => {
    const id = send('tools/call', {
      name: 'history',
      arguments: { limit: 10 },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    const ops = result.entries.map((e: any) => e.operation);
    expect(ops).toContain('create');
    expect(ops).toContain('update');
  });

  it('should find duplicates when similar contacts exist', async () => {
    // Create a duplicate
    const createId = send('tools/call', {
      name: 'create_contact',
      arguments: {
        fullName: 'Integ User',
        emails: [{ value: 'integ@test.com' }], // same email
      },
    });
    await waitForResponse(createId);

    const id = send('tools/call', {
      name: 'find_duplicates',
      arguments: { threshold: 0.5 },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.duplicatesFound).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should rollback the last change', async () => {
    const id = send('tools/call', {
      name: 'rollback',
      arguments: { mode: 'last-n', count: 1 },
    });
    const resp = await waitForResponse(id);
    const result = JSON.parse(resp.result.content[0].text);

    expect(result.revertedCommits).toBe(1);
    expect(result.safetyTag).toContain('pre-rollback-');
  });

  it('should return error for non-existent contact', async () => {
    const id = send('tools/call', {
      name: 'get_contact',
      arguments: { id: 'nonexistent-uuid-0000' },
    });
    const resp = await waitForResponse(id);

    expect(resp.result.isError).toBe(true);
    expect(resp.result.content[0].text).toContain('not found');
  });
});

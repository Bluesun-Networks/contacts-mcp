import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GitContactStore } from '../store/index.js';
import { resolveContactPoints } from '../contacts/index.js';

export function registerResolveTool(server: McpServer, store: GitContactStore): void {
  server.registerTool('resolve_contact_points', {
    description: 'Resolve phone numbers and email addresses to contacts using exact normalized matching.',
    inputSchema: {
      emails: z.array(z.string()).optional().default([]).describe('Email addresses to resolve'),
      phones: z.array(z.string()).optional().default([]).describe('Phone numbers to resolve'),
      defaultCountry: z.string().optional().default('US').describe('Default country for phone normalization'),
      includeArchived: z.boolean().optional().default(false).describe('Include archived/deleted contacts'),
    },
  }, async ({ emails, phones, defaultCountry, includeArchived }) => {
    const contacts = await store.list(includeArchived);
    const result = resolveContactPoints(contacts, {
      emails,
      phones,
      defaultCountry,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GitContactStore } from '../store/index.js';
import type { AppConfig } from '../config.js';
import { SyncEngine } from '../sync/engine.js';
import { AppleProvider } from '../providers/apple.js';
import { GoogleProvider } from '../providers/google.js';
import { CardDAVProvider } from '../providers/carddav.js';
import type { ContactProvider } from '../types/index.js';
import { logger } from '../utils/index.js';

function createProvider(providerConfig: { name: string; type: string; config?: Record<string, unknown> }): ContactProvider | null {
  switch (providerConfig.type) {
    case 'apple':
      return new AppleProvider(providerConfig.name, providerConfig.config ?? {});
    case 'google':
      return new GoogleProvider(providerConfig.name, providerConfig.config ?? {});
    case 'carddav':
      return new CardDAVProvider(providerConfig.name, providerConfig.config ?? {});
    default:
      logger.error(`Unknown provider type: ${providerConfig.type}`);
      return null;
  }
}

export function registerSyncTool(server: McpServer, store: GitContactStore, config?: AppConfig): void {
  server.registerTool('sync_provider', {
    description: 'Synchronize contacts with a remote provider. Pulls new/changed contacts and pushes local changes.',
    inputSchema: {
      provider: z.string().describe('Provider name (e.g., "apple", "google-personal", "fastmail")'),
      direction: z.enum(['pull', 'push', 'both']).optional().default('both'),
      conflictStrategy: z.enum(['local-wins', 'remote-wins', 'newest-wins', 'manual']).optional().default('newest-wins'),
      dryRun: z.boolean().optional().default(false),
    },
  }, async ({ provider: providerName, direction, conflictStrategy, dryRun }) => {
    // Find provider config
    const providerConfigs = config?.providers ?? [];
    const providerCfg = providerConfigs.find(
      p => p.name === providerName && p.enabled !== false
    );

    if (!providerCfg) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `Provider "${providerName}" not found or not enabled.`,
            configured: providerConfigs.map(p => ({ name: p.name, type: p.type, enabled: p.enabled !== false })),
            hint: 'Configure providers in ~/.contacts-mcp/config.json',
          }, null, 2),
        }],
        isError: true,
      };
    }

    const provider = createProvider(providerCfg);
    if (!provider) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: `Unknown provider type: ${providerCfg.type}` }, null, 2),
        }],
        isError: true,
      };
    }

    const configured = await provider.isConfigured();
    if (!configured) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `Provider "${providerName}" (${providerCfg.type}) is not properly configured or accessible.`,
            hint: providerCfg.type === 'apple'
              ? 'Ensure macOS Contacts permission is granted in System Settings > Privacy & Security > Contacts.'
              : 'Check your credentials in ~/.contacts-mcp/config.json',
          }, null, 2),
        }],
        isError: true,
      };
    }

    const engine = new SyncEngine(store);
    const result = await engine.sync(provider, {
      direction,
      conflictStrategy,
      dryRun,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ...result,
          dryRun,
          message: dryRun
            ? `Dry run complete. Would pull ${result.pulled}, push ${result.pushed}.`
            : `Sync complete. Pulled ${result.pulled}, pushed ${result.pushed}.`,
        }, null, 2),
      }],
    };
  });
}

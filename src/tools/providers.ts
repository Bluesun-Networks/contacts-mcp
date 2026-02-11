import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GitContactStore } from '../store/index.js';
import type { AppConfig } from '../config.js';
import { AppleProvider } from '../providers/apple.js';
import { GoogleProvider } from '../providers/google.js';
import { CardDAVProvider } from '../providers/carddav.js';

export function registerProvidersTool(server: McpServer, _store: GitContactStore, config?: AppConfig): void {
  server.registerTool('list_providers', {
    description: 'List all configured contact providers and their sync status.',
  }, async () => {
    const providers: any[] = [
      {
        name: 'local',
        type: 'local',
        configured: true,
        enabled: true,
        description: 'Local git-backed contact store (always available)',
      },
    ];

    for (const cfg of config?.providers ?? []) {
      let configured = false;
      try {
        let provider;
        switch (cfg.type) {
          case 'apple': provider = new AppleProvider(cfg.name, cfg.config ?? {}); break;
          case 'google': provider = new GoogleProvider(cfg.name, cfg.config ?? {}); break;
          case 'carddav': provider = new CardDAVProvider(cfg.name, cfg.config ?? {}); break;
        }
        if (provider) configured = await provider.isConfigured();
      } catch { /* ignore */ }

      providers.push({
        name: cfg.name,
        type: cfg.type,
        configured,
        enabled: cfg.enabled !== false,
      });
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ providers }, null, 2),
      }],
    };
  });
}

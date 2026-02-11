import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitContactStore } from './store/index.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import type { AppConfig } from './config.js';
import { logger } from './utils/index.js';

export function createServer(config: AppConfig): { server: McpServer; store: GitContactStore } {
  const server = new McpServer({
    name: 'contacts-mcp',
    version: '0.1.0',
  });

  const store = new GitContactStore(config.storePath);

  registerAllTools(server, store, config);
  registerAllResources(server, store);

  logger.info('MCP server created, store path:', config.storePath);

  return { server, store };
}

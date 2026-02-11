import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GitContactStore } from '../store/index.js';
import type { AppConfig } from '../config.js';
import { registerSearchTool } from './search.js';
import { registerGetTool } from './get.js';
import { registerCreateTool } from './create.js';
import { registerUpdateTool } from './update.js';
import { registerDeleteTool } from './delete.js';
import { registerDuplicatesTool } from './duplicates.js';
import { registerMergeTool } from './merge.js';
import { registerImportTool } from './import.js';
import { registerExportTool } from './export.js';
import { registerSyncTool } from './sync.js';
import { registerProvidersTool } from './providers.js';
import { registerRollbackTool } from './rollback.js';
import { registerHistoryTool } from './history.js';

export function registerAllTools(server: McpServer, store: GitContactStore, config?: AppConfig): void {
  registerSearchTool(server, store);
  registerGetTool(server, store);
  registerCreateTool(server, store);
  registerUpdateTool(server, store);
  registerDeleteTool(server, store);
  registerDuplicatesTool(server, store);
  registerMergeTool(server, store);
  registerImportTool(server, store);
  registerExportTool(server, store);
  registerSyncTool(server, store, config);
  registerProvidersTool(server, store, config);
  registerRollbackTool(server, store);
  registerHistoryTool(server, store);
}

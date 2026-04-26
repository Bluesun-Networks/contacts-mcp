import * as fs from 'node:fs/promises';
import { loadConfig } from './config.js';
import { GitContactStore } from './store/index.js';
import { resolveContactPoints, contactToVCard } from './contacts/index.js';

interface CliOptions {
  command: string;
  output?: string;
  input?: string;
  includeArchived: boolean;
  defaultCountry: string;
  format: 'json' | 'csv' | 'vcf';
}

export async function maybeRunCli(argv: string[]): Promise<boolean> {
  const command = argv[2];
  if (!command || command === 'serve') return false;
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return true;
  }
  if (!['export', 'resolve'].includes(command)) return false;

  const options = parseOptions(argv.slice(2));
  const config = await loadConfig();
  const store = new GitContactStore(config.storePath);
  await store.init();

  if (options.command === 'export') {
    const contacts = await store.list(options.includeArchived);
    const output = formatContacts(contacts, options.format);
    await writeOutput(options.output, output);
    return true;
  }

  const input = await readInput(options.input);
  const contacts = await store.list(options.includeArchived);
  const result = resolveContactPoints(contacts, {
    emails: input.emails ?? [],
    phones: input.phones ?? [],
    defaultCountry: input.defaultCountry ?? options.defaultCountry,
  });
  await writeOutput(options.output, JSON.stringify(result, null, 2));
  return true;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    command: args[0] ?? '',
    includeArchived: false,
    defaultCountry: 'US',
    format: 'json',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--input':
      case '-i':
        options.input = args[++i];
        break;
      case '--include-archived':
        options.includeArchived = true;
        break;
      case '--default-country':
        options.defaultCountry = args[++i] ?? 'US';
        break;
      case '--format': {
        const format = args[++i];
        if (format !== 'json' && format !== 'csv' && format !== 'vcf') {
          throw new Error(`Unsupported export format: ${format}`);
        }
        options.format = format;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function readInput(inputPath?: string): Promise<{
  emails?: string[];
  phones?: string[];
  defaultCountry?: string;
}> {
  const text = inputPath && inputPath !== '-'
    ? await fs.readFile(inputPath, 'utf-8')
    : await readStdin();
  return JSON.parse(text);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function writeOutput(outputPath: string | undefined, output: string): Promise<void> {
  if (!outputPath || outputPath === '-') {
    process.stdout.write(output);
    process.stdout.write('\n');
    return;
  }
  await fs.writeFile(outputPath, output, 'utf-8');
}

function formatContacts(
  contacts: Awaited<ReturnType<GitContactStore['list']>>,
  format: 'json' | 'csv' | 'vcf',
): string {
  if (format === 'json') return JSON.stringify(contacts, null, 2);
  if (format === 'vcf') return contacts.map(contactToVCard).join('\r\n');
  return contactsToCsv(contacts);
}

function contactsToCsv(contacts: Awaited<ReturnType<GitContactStore['list']>>): string {
  const headers = ['ID', 'Full Name', 'Email', 'Phone', 'Organization', 'Title'];
  const rows = contacts.map(c => [
    c.id,
    csvEscape(c.fullName),
    csvEscape(c.emails.map(e => e.value).join('; ')),
    csvEscape(c.phones.map(p => p.value).join('; ')),
    csvEscape(c.organization?.name ?? ''),
    csvEscape(c.organization?.title ?? ''),
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function printHelp(): void {
  process.stdout.write(`contacts-mcp

Usage:
  contacts-mcp serve
  contacts-mcp export [--format json|csv|vcf] [--output path|-] [--include-archived]
  contacts-mcp resolve --input path|- [--output path|-] [--include-archived] [--default-country US]

Without a command, contacts-mcp starts the MCP stdio server.
`);
}

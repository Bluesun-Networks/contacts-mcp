# contacts-mcp

An MCP server that gives AI assistants full contact management capabilities — create, search, deduplicate, merge, sync across systems, and roll back any change with confidence.

Contacts are stored as individual vCard files in a git repository. Every mutation is a git commit, so you get full version history, diffs, and revert for free. The AI can make sweeping changes knowing everything is recoverable.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.0+
- Git (available in PATH)

### Install & Build

```bash
cd contacts-mcp
bun install
bun run build
```

### Add to Claude Code

```bash
claude mcp add contacts bun /path/to/contacts-mcp/dist/index.js
```

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contacts": {
      "command": "bun",
      "args": ["/path/to/contacts-mcp/dist/index.js"]
    }
  }
}
```

### Development Mode

Run directly from source without building (bun runs TypeScript natively):

```bash
bun run dev
```

### Verify It Works

Use the MCP Inspector to test interactively:

```bash
bunx @modelcontextprotocol/inspector bun dist/index.js
```

## What It Does

Once connected, your AI assistant gets 14 tools and 4 resources for managing contacts:

### Tools

| Tool | What it does |
|---|---|
| `create_contact` | Create a contact with name, emails, phones, addresses, org, birthday, notes, categories. Phone numbers are auto-normalized to E.164. |
| `get_contact` | Retrieve full contact details by UUID. |
| `update_contact` | Partial update — only fields you specify are changed, everything else is preserved. |
| `delete_contact` | Soft-delete (moves to archive). Optional permanent delete. Archived contacts can be restored via rollback. |
| `search_contacts` | Fuzzy search across all fields (name, email, phone, org, notes, categories). Ranked by relevance. |
| `find_duplicates` | Scan for potential duplicates with confidence scores. Matches on email (0.95), phone (0.90), name (fuzzy, 0.50-0.70), with org boost. |
| `merge_contacts` | Merge 2+ contacts into one. Strategies: `union` (combine all data), `keep-newest`, `keep-oldest`. Manual field overrides supported. |
| `import_contacts` | Bulk import from a `.vcf` file. Optional dedup check against existing contacts. Dry-run mode. |
| `export_contacts` | Export to `.vcf`, `.csv`, or `.json`. Optional search filter. |
| `resolve_contact_points` | Resolve phone numbers and email addresses to contacts using exact normalized matching. Reports matched, ambiguous, and unresolved results. |
| `sync_provider` | Sync with a configured remote provider (Google, Apple, CardDAV). Pull, push, or both. Configurable conflict resolution. |
| `list_providers` | Show all configured providers and their sync status. |
| `rollback` | Undo changes by reverting git commits. Modes: undo last N, revert to a specific commit, revert to a tag. Dry-run supported. Creates a safety tag first so the rollback itself can be undone. |
| `history` | View change history — globally or for a specific contact. Shows operation type, commit hash, date, and message. |

### CLI Export And Resolve

The binary still starts the MCP stdio server by default. It also supports deterministic
non-AI command-line operations for other local tools:

```bash
contacts-mcp export --format json --output contacts.json
contacts-mcp export --format json --output -
contacts-mcp resolve --input contact-points.json --output -
```

`resolve` input is JSON:

```json
{
  "phones": ["+18016022838", "(801) 602-2838"],
  "emails": ["alex@example.com"],
  "defaultCountry": "US"
}
```

Use `CONTACTS_MCP_STORE=/path/to/store` when exporting or resolving against a custom
store path.

### Resources

| URI | Description |
|---|---|
| `contacts://all` | Summary list of all active contacts |
| `contacts://{id}` | Full detail for a specific contact (resource template — lists all contacts for discovery) |
| `contacts://duplicates` | Current duplicate candidates with confidence scores |
| `contacts://history` | Recent change log |

## How Storage Works

```
~/.contacts-mcp/store/
├── .git/                    # Git repository
├── contacts/
│   ├── <uuid>.vcf          # One vCard 4.0 file per contact
│   └── ...
├── archive/
│   └── <uuid>.vcf          # Soft-deleted contacts
└── .metadata/
    ├── providers.json       # Provider config & sync state
    └── merge-log.json       # Audit trail for merges
```

- **One file per contact** — each contact is a standard vCard 4.0 (`.vcf`) file named by its UUID.
- **Every change is a commit** — creating, updating, deleting, merging, importing all produce descriptive git commits like `Create contact: Jane Smith (uuid)` or `Merge contacts: Jane + J. Smith -> Jane Smith`.
- **Soft deletes** — `delete_contact` moves the file from `contacts/` to `archive/`. It's still in the repo and can be found by `get_contact` or restored via rollback.
- **Bulk operations get tags** — imports and syncs create `pre-import-<timestamp>` / `post-import-<timestamp>` git tags so you can roll back an entire bulk operation in one shot.
- **Rollback = git revert** — always creates new commits (never `reset --hard`), so the full audit trail is preserved and rollbacks are themselves reversible.

## Configuration

Configuration is loaded from `~/.contacts-mcp/config.json` (or the path in `CONTACTS_MCP_CONFIG` env var).

### Minimal Config (Local Only)

No config file needed. The server works out of the box with the local git store at `~/.contacts-mcp/store/`.

### Custom Store Path

```json
{
  "storePath": "/path/to/my/contacts-repo"
}
```

Or via environment variable:

```bash
CONTACTS_MCP_STORE=/path/to/my/contacts-repo bun dist/index.js
```

### Full Config with Providers

```json
{
  "storePath": "~/.contacts-mcp/store",
  "providers": [
    {
      "name": "google-personal",
      "type": "google",
      "enabled": true,
      "config": {
        "clientId": "your-client-id.apps.googleusercontent.com",
        "clientSecret": "your-client-secret",
        "refreshToken": "your-refresh-token"
      }
    },
    {
      "name": "fastmail",
      "type": "carddav",
      "enabled": true,
      "config": {
        "serverUrl": "https://carddav.fastmail.com/dav/addressbooks",
        "username": "you@fastmail.com",
        "password": "app-specific-password",
        "authMethod": "Basic"
      }
    },
    {
      "name": "apple",
      "type": "apple",
      "enabled": true,
      "config": {}
    }
  ]
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CONTACTS_MCP_CONFIG` | `~/.contacts-mcp/config.json` | Path to config file |
| `CONTACTS_MCP_STORE` | `~/.contacts-mcp/store` | Path to git-backed contact store |
| `DEBUG` | (unset) | Set to any value to enable debug logging |

## Provider Setup

### Google Contacts

Uses the Google People API. You need OAuth2 credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **People API**.
3. Create OAuth2 credentials (Desktop app type).
4. Use the OAuth2 playground or a script to get a refresh token with `https://www.googleapis.com/auth/contacts` scope.
5. Add `clientId`, `clientSecret`, and `refreshToken` to your config.

### Apple Contacts (macOS only)

Uses JavaScript for Automation (JXA) via `osascript`. No credentials needed, but:

1. The first time you sync, macOS will prompt you to allow terminal/IDE access to Contacts.
2. Grant permission in **System Settings > Privacy & Security > Contacts**.
3. Config is just `"config": {}` — no fields required.

### CardDAV

Works with any CardDAV server — Fastmail, Nextcloud, Radicale, iCloud, etc.

| Config field | Description |
|---|---|
| `serverUrl` | CardDAV server URL (e.g., `https://carddav.fastmail.com/dav/addressbooks`) |
| `username` | Your username |
| `password` | Password or app-specific password |
| `authMethod` | `"Basic"` (default) or `"Digest"` |

For **iCloud**: use an [app-specific password](https://support.apple.com/en-us/102654) and `https://contacts.icloud.com` as the server URL.

## How Dedup Works

The `find_duplicates` tool compares contacts using weighted field matching:

| Match type | Confidence | How it works |
|---|---|---|
| Same email (normalized) | 0.95 | Case-insensitive exact match on any email |
| Same phone (normalized) | 0.90 | E.164 normalization, so `(555) 123-4567` matches `+15551234567` |
| Exact name | 0.70 | Full name string match |
| Fuzzy name | 0.50 | Levenshtein distance, handles swapped names ("John Smith" / "Smith, John") and initials ("J. Smith" / "Jane Smith") |
| Same organization | +0.15 | Additive boost (never standalone — only increases existing score) |

Contacts are grouped into **blocking keys** (by name initials, email domain, phone suffix) before comparison, so performance stays fast even with thousands of contacts.

The default threshold is 0.6 — anything scored at or above that is reported as a potential duplicate.

## How Merge Works

`merge_contacts` takes 2+ contact IDs and combines them:

- **First ID is the primary** — it keeps its UUID, the others are archived.
- **`union` strategy** (default) — combines all emails, phones, addresses, URLs, categories. Takes the longer/more complete name. Picks up birthday, org, photo from whichever has it.
- **`keep-newest`** — takes all fields from the most recently modified contact.
- **`keep-oldest`** — takes all fields from the earliest modified contact.
- **`fieldOverrides`** — manually specify which contact's value to use for specific fields: `{ "organization": "uuid-of-contact-with-better-org" }`.
- **Provider IDs are merged** — so if contact A was from Google and contact B was from CardDAV, the merged contact maps to both remotes.

## How Sync Works

Sync is **local-first** and **explicit** (triggered by the `sync_provider` tool, never automatic):

1. **Pull**: Fetch contacts from the remote. New ones are imported locally. Changed ones are updated based on conflict strategy.
2. **Push**: Local contacts modified since last sync are pushed to the remote. New local contacts get created remotely.
3. **Conflict resolution** (when both sides changed):
   - `newest-wins` (default) — compare modification timestamps, keep the newer one.
   - `local-wins` — always keep the local version.
   - `remote-wins` — always accept the remote version.
   - `manual` — flag as conflict, don't auto-resolve.
4. Pre/post sync git tags are created for rollback.

## Project Structure

```
src/
├── index.ts                # Entry point — stdio transport
├── server.ts               # McpServer setup, wires tools + resources
├── config.ts               # Config loading from file / env vars
├── types/                  # TypeScript interfaces (Contact, Provider, etc.)
├── contacts/
│   ├── model.ts            # Contact construction + name parsing
│   ├── vcard.ts            # vCard 4.0 serialize/deserialize (no external lib)
│   ├── normalize.ts        # Phone (E.164), email, name normalization
│   ├── search.ts           # Fuse.js fuzzy search
│   ├── dedup.ts            # Duplicate detection with weighted scoring
│   └── merge.ts            # Contact merge with multiple strategies
├── store/
│   ├── git-ops.ts          # Low-level git wrapper (simple-git)
│   ├── git-store.ts        # CRUD + bulk ops + history + rollback
│   └── file-layout.ts      # Path conventions
├── providers/
│   ├── base.ts             # Abstract provider
│   ├── google.ts           # Google People API
│   ├── apple.ts            # macOS Contacts via JXA
│   ├── carddav.ts          # CardDAV via tsdav
│   └── local.ts            # Local store wrapper
├── sync/
│   ├── engine.ts           # Bidirectional sync orchestration
│   ├── conflict.ts         # Conflict resolution
│   └── diff.ts             # Field-level contact diffing
├── tools/                  # One file per MCP tool (13 tools)
└── resources/              # MCP resource handlers (4 resources)
```

## Tech Stack

| Component | Library | Why |
|---|---|---|
| MCP server | `@modelcontextprotocol/sdk` | Official SDK, stdio transport |
| Schema validation | `zod` | Required by MCP SDK for tool input schemas |
| Git operations | `simple-git` | Clean async API over git CLI |
| Fuzzy search | `fuse.js` | Fast client-side fuzzy matching with field weights |
| Phone normalization | `libphonenumber-js` | Google's libphonenumber for E.164 normalization |
| Google Contacts | `googleapis` | Official Google API client (People API v1) |
| CardDAV | `tsdav` | WebDAV/CardDAV client for address book sync |
| Apple Contacts | `osascript` (JXA) | Built-in macOS automation, no extra deps |
| vCard parsing | Custom | Hand-rolled RFC 6350 parser/serializer — zero dependencies, full round-trip fidelity |

## License

MIT

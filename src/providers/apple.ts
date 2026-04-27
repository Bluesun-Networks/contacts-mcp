import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Contact } from '../types/index.js';
import { BaseProvider } from './base.js';
import { createContact } from '../contacts/model.js';
import { generateId, logger, ProviderError } from '../utils/index.js';

const execFileAsync = promisify(execFile);

/**
 * Apple Contacts provider using JXA (JavaScript for Automation) via osascript.
 * Only works on macOS. Requires Contacts access permission.
 */
export class AppleProvider extends BaseProvider {
  readonly name: string;
  readonly type = 'apple' as const;

  constructor(name: string = 'apple', config: Record<string, unknown> = {}) {
    super(config);
    this.name = name;
  }

  async isConfigured(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    try {
      await this.runJxa('Application("Contacts").name()');
      return true;
    } catch {
      return false;
    }
  }

  async fetchAll(): Promise<Contact[]> {
    const script = `
      const app = Application("Contacts");
      const people = app.people();
      const results = [];
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        try {
          results.push({
            id: p.id(),
            firstName: p.firstName() || '',
            lastName: p.lastName() || '',
            middleName: p.middleName() || '',
            nickname: p.nickname() || '',
            organization: p.organization() || '',
            jobTitle: p.jobTitle() || '',
            note: p.note() || '',
            birthday: p.birthDate() ? p.birthDate().toISOString().split('T')[0] : null,
            emails: p.emails().map(e => ({ value: e.value(), label: e.label() })),
            phones: p.phones().map(ph => ({ value: ph.value(), label: ph.label() })),
            addresses: p.addresses().map(a => ({
              street: a.street() || '',
              city: a.city() || '',
              state: a.state() || '',
              zip: a.zip() || '',
              country: a.country() || '',
              label: a.label() || '',
            })),
            urls: p.urls().map(u => ({ value: u.value(), label: u.label() })),
          });
        } catch(e) { /* skip contacts that error */ }
      }
      JSON.stringify(results);
    `;

    const output = await this.runJxa(script);
    const rawContacts = JSON.parse(output);

    const contacts: Contact[] = rawContacts.map((r: any) => this.rawToContact(r));
    logger.info(`Apple: fetched ${contacts.length} contacts`);
    return contacts;
  }

  async fetchOne(remoteId: string): Promise<Contact | null> {
    const script = `
      const app = Application("Contacts");
      const people = app.people.whose({ id: "${remoteId.replace(/"/g, '\\"')}" })();
      if (people.length === 0) { JSON.stringify(null); }
      else {
        const p = people[0];
        JSON.stringify({
          id: p.id(),
          firstName: p.firstName() || '',
          lastName: p.lastName() || '',
          middleName: p.middleName() || '',
          organization: p.organization() || '',
          jobTitle: p.jobTitle() || '',
          note: p.note() || '',
          birthday: p.birthDate() ? p.birthDate().toISOString().split('T')[0] : null,
          emails: p.emails().map(e => ({ value: e.value(), label: e.label() })),
          phones: p.phones().map(ph => ({ value: ph.value(), label: ph.label() })),
          addresses: p.addresses().map(a => ({
            street: a.street() || '', city: a.city() || '', state: a.state() || '',
            zip: a.zip() || '', country: a.country() || '', label: a.label() || '',
          })),
          urls: p.urls().map(u => ({ value: u.value(), label: u.label() })),
        });
      }
    `;

    const output = await this.runJxa(script);
    const raw = JSON.parse(output);
    if (!raw) return null;
    return this.rawToContact(raw);
  }

  async pushContact(contact: Contact): Promise<string> {
    const c = contact;
    const script = `
      const app = Application("Contacts");
      const p = app.Person({
        firstName: ${JSON.stringify(c.name.givenName ?? '')},
        lastName: ${JSON.stringify(c.name.familyName ?? '')},
        organization: ${JSON.stringify(c.organization?.name ?? '')},
        jobTitle: ${JSON.stringify(c.organization?.title ?? '')},
        note: ${JSON.stringify(c.notes ?? '')},
      });
      app.people.push(p);
      ${c.emails.map(e => `p.emails.push(app.Email({ value: ${JSON.stringify(e.value)}, label: ${JSON.stringify(e.type ?? 'other')} }));`).join('\n')}
      ${c.phones.map(p => `p.phones.push(app.Phone({ value: ${JSON.stringify(p.value)}, label: ${JSON.stringify(p.type ?? 'other')} }));`).join('\n')}
      app.save();
      p.id();
    `;

    const id = await this.runJxa(script);
    return id.trim();
  }

  async updateContact(remoteId: string, contact: Contact): Promise<void> {
    // Apple Contacts doesn't have a clean update API via JXA.
    // Strategy: delete and re-create.
    await this.deleteContact(remoteId);
    await this.pushContact(contact);
  }

  async deleteContact(remoteId: string): Promise<void> {
    const script = `
      const app = Application("Contacts");
      const people = app.people.whose({ id: "${remoteId.replace(/"/g, '\\"')}" })();
      if (people.length > 0) {
        app.delete(people[0]);
        app.save();
      }
      'ok';
    `;
    await this.runJxa(script);
  }

  private rawToContact(raw: any): Contact {
    const fullName = [raw.firstName, raw.middleName, raw.lastName].filter(Boolean).join(' ') || 'Unknown';

    return createContact({
      id: generateId(),
      fullName,
      name: {
        givenName: raw.firstName || undefined,
        middleName: raw.middleName || undefined,
        familyName: raw.lastName || undefined,
      },
      emails: (raw.emails ?? []).map((e: any) => ({
        value: e.value,
        type: mapAppleLabel(e.label),
      })),
      phones: (raw.phones ?? []).map((p: any) => ({
        value: p.value,
        type: mapAppleLabel(p.label),
      })),
      addresses: (raw.addresses ?? []).map((a: any) => ({
        street: a.street || undefined,
        city: a.city || undefined,
        state: a.state || undefined,
        postalCode: a.zip || undefined,
        country: a.country || undefined,
        type: mapAppleLabel(a.label),
      })),
      organization: raw.organization ? {
        name: raw.organization,
        title: raw.jobTitle || undefined,
      } : undefined,
      birthday: raw.birthday || undefined,
      urls: (raw.urls ?? []).map((u: any) => ({
        value: u.value,
        type: mapAppleLabel(u.label),
      })),
      notes: raw.note || undefined,
      metadata: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        source: this.name,
        providerIds: { [this.name]: raw.id },
        archived: false,
      },
    });
  }

  private jxaTimeoutMs(): number {
    const configured = this.config.timeoutMs ?? process.env.CONTACTS_MCP_APPLE_TIMEOUT_MS;
    const parsed = Number(configured);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 600000;
  }

  private async runJxa(script: string): Promise<string> {
    const timeout = this.jxaTimeoutMs();
    try {
      const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
        timeout,
        maxBuffer: 50 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (err: any) {
      const timedOut = err.killed || err.signal === 'SIGTERM' || /timed out/i.test(err.message ?? '');
      const hint = timedOut
        ? ` (timed out after ${timeout}ms; large Apple Contacts libraries can need a higher CONTACTS_MCP_APPLE_TIMEOUT_MS)`
        : '';
      throw new ProviderError(this.name, `JXA error${hint}: ${err.message}`);
    }
  }
}

function mapAppleLabel(label?: string): string | undefined {
  if (!label) return undefined;
  const lower = label.toLowerCase().replace(/^_\$!<|>!\$_$/g, '');
  if (lower.includes('home')) return 'home';
  if (lower.includes('work')) return 'work';
  if (lower.includes('mobile') || lower.includes('cell')) return 'mobile';
  return 'other';
}

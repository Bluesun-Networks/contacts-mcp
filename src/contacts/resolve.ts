import type { Contact, ContactSummary } from '../types/index.js';
import { toSummary } from '../types/index.js';
import { normalizeEmail, normalizePhone } from './normalize.js';

export interface ContactPointQuery {
  type: 'email' | 'phone';
  value: string;
}

export interface ResolvedContactPoint {
  query: ContactPointQuery;
  normalized: string;
  contacts: ContactSummary[];
  confidence: number;
  matchedOn: 'email' | 'phone';
  status: 'matched' | 'ambiguous' | 'unresolved';
}

export interface ResolveContactPointsInput {
  emails?: string[];
  phones?: string[];
  defaultCountry?: string;
}

export interface ResolveContactPointsResult {
  results: ResolvedContactPoint[];
  matched: number;
  ambiguous: number;
  unresolved: number;
}

export function resolveContactPoints(
  contacts: Contact[],
  input: ResolveContactPointsInput,
): ResolveContactPointsResult {
  const emailIndex = new Map<string, Contact[]>();
  const phoneIndex = new Map<string, Contact[]>();
  const defaultCountry = input.defaultCountry ?? 'US';

  for (const contact of contacts) {
    for (const email of contact.emails) {
      addToIndex(emailIndex, normalizeEmail(email.value), contact);
    }
    for (const phone of contact.phones) {
      addToIndex(phoneIndex, normalizePhone(phone.value, defaultCountry), contact);
    }
  }

  const results: ResolvedContactPoint[] = [];
  for (const value of input.emails ?? []) {
    const normalized = normalizeEmail(value);
    results.push(resolveOne({ type: 'email', value }, normalized, emailIndex, 0.95, 'email'));
  }
  for (const value of input.phones ?? []) {
    const normalized = normalizePhone(value, defaultCountry);
    results.push(resolveOne({ type: 'phone', value }, normalized, phoneIndex, 0.9, 'phone'));
  }

  return {
    results,
    matched: results.filter(r => r.status === 'matched').length,
    ambiguous: results.filter(r => r.status === 'ambiguous').length,
    unresolved: results.filter(r => r.status === 'unresolved').length,
  };
}

function addToIndex(
  index: Map<string, Contact[]>,
  key: string,
  contact: Contact,
): void {
  if (!key) return;
  const entries = index.get(key) ?? [];
  if (!entries.some(existing => existing.id === contact.id)) {
    entries.push(contact);
  }
  index.set(key, entries);
}

function resolveOne(
  query: ContactPointQuery,
  normalized: string,
  index: Map<string, Contact[]>,
  confidence: number,
  matchedOn: 'email' | 'phone',
): ResolvedContactPoint {
  const contacts = index.get(normalized) ?? [];
  const status = contacts.length === 0
    ? 'unresolved'
    : contacts.length === 1
      ? 'matched'
      : 'ambiguous';
  return {
    query,
    normalized,
    contacts: contacts.map(toSummary),
    confidence: contacts.length === 0 ? 0 : confidence,
    matchedOn,
    status,
  };
}

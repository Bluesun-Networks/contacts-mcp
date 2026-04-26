import { describe, expect, it } from 'vitest';
import { createContact, normalizeContact, resolveContactPoints } from '../../src/contacts/index.js';

describe('resolveContactPoints', () => {
  const contacts = [
    normalizeContact(createContact({
      fullName: 'Alex Example',
      emails: [{ value: 'alex@example.com' }],
      phones: [{ value: '(801) 602-2838' }],
    })),
    normalizeContact(createContact({
      fullName: 'Duplicate Phone',
      phones: [{ value: '+18016022838' }],
    })),
  ];

  it('resolves exact normalized email matches', () => {
    const result = resolveContactPoints(contacts, { emails: [' ALEX@EXAMPLE.COM '] });

    expect(result.matched).toBe(1);
    expect(result.results[0].status).toBe('matched');
    expect(result.results[0].normalized).toBe('alex@example.com');
    expect(result.results[0].confidence).toBe(0.95);
    expect(result.results[0].contacts[0].fullName).toBe('Alex Example');
  });

  it('marks duplicate phone matches as ambiguous', () => {
    const result = resolveContactPoints(contacts, { phones: ['801-602-2838'] });

    expect(result.ambiguous).toBe(1);
    expect(result.results[0].status).toBe('ambiguous');
    expect(result.results[0].normalized).toBe('+18016022838');
    expect(result.results[0].contacts).toHaveLength(2);
  });

  it('reports unresolved contact points', () => {
    const result = resolveContactPoints(contacts, { phones: ['+15551234567'] });

    expect(result.unresolved).toBe(1);
    expect(result.results[0].status).toBe('unresolved');
    expect(result.results[0].confidence).toBe(0);
  });
});

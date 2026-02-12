import crypto from 'node:crypto';

export function signAuditEvent(event, previousHash) {
  const previous = previousHash || null;
  const hash = computeAuditHash({ ...event, previousHash: previous });
  return {
    ...event,
    previousHash: previous,
    hash
  };
}

export function computeAuditHash(event) {
  const payload = {
    tenderId: event.tenderId,
    eventId: event.eventId,
    type: event.type,
    createdAt: event.createdAt,
    previousHash: event.previousHash || null,
    details: event.details || {}
  };
  const canonical = stableStringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuditChain(events, options = {}) {
  const allowUnsignedPrefix = options.allowUnsignedPrefix !== false;
  const chronological = [...(events || [])].sort((a, b) => compareEventsAsc(a, b));

  let expectedPrevious = null;
  let signedSeen = false;
  const issues = [];
  let unsignedCount = 0;

  for (const event of chronological) {
    const hasHash = Boolean(event?.hash);
    if (!hasHash) {
      unsignedCount += 1;
      if (signedSeen || !allowUnsignedPrefix) {
        issues.push({
          eventId: event?.eventId || null,
          reason: 'unsigned_event'
        });
      }
      continue;
    }

    signedSeen = true;
    const prev = event.previousHash || null;
    if (prev !== expectedPrevious) {
      issues.push({
        eventId: event.eventId,
        reason: 'previous_hash_mismatch',
        expectedPrevious,
        actualPrevious: prev
      });
    }

    const recomputed = computeAuditHash(event);
    if (event.hash !== recomputed) {
      issues.push({
        eventId: event.eventId,
        reason: 'hash_mismatch',
        expectedHash: recomputed,
        actualHash: event.hash
      });
    }

    expectedPrevious = event.hash;
  }

  const valid = issues.length === 0;
  return {
    valid,
    complete: valid && unsignedCount === 0,
    unsignedCount,
    signedCount: chronological.length - unsignedCount,
    eventCount: chronological.length,
    issues
  };
}

export function backfillAuditChainEvents(events, options = {}) {
  const forceRewrite = Boolean(options.forceRewrite);
  const chronological = [...(events || [])].sort((a, b) => compareEventsAsc(a, b));
  const unsignedCount = chronological.filter((event) => !event.hash).length;
  const signedCount = chronological.length - unsignedCount;

  if (!forceRewrite && unsignedCount === 0) {
    return {
      events: chronological,
      signedCount,
      unsignedCount,
      rewrittenCount: 0,
      mode: 'noop'
    };
  }

  if (!forceRewrite && signedCount > 0 && unsignedCount > 0) {
    throw new Error(
      'Cannot backfill unsigned legacy events when signed events already exist. Use forceRewrite=true to rebuild the full chain.'
    );
  }

  let previousHash = null;
  let rewrittenCount = 0;
  const rewritten = chronological.map((event) => {
    if (!forceRewrite && event.hash) {
      previousHash = event.hash;
      return event;
    }
    const signed = signAuditEvent(
      {
        eventId: event.eventId,
        tenderId: event.tenderId,
        type: event.type,
        details: event.details,
        createdAt: event.createdAt
      },
      previousHash
    );
    previousHash = signed.hash;
    rewrittenCount += 1;
    return signed;
  });

  return {
    events: rewritten,
    signedCount: rewritten.length,
    unsignedCount: 0,
    rewrittenCount,
    mode: forceRewrite ? 'force_rewrite' : 'backfill_unsigned'
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${pairs.join(',')}}`;
}

function compareEventsAsc(a, b) {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  if ((a.eventId || '') < (b.eventId || '')) return -1;
  if ((a.eventId || '') > (b.eventId || '')) return 1;
  return 0;
}

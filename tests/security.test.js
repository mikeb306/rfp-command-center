import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityControls, hasRequiredRole } from '../src/lib/security.js';

test('hasRequiredRole enforces hierarchy', () => {
  assert.equal(hasRequiredRole('admin', ['reviewer']), true);
  assert.equal(hasRequiredRole('editor', ['reviewer']), false);
  assert.equal(hasRequiredRole('reviewer', ['editor']), true);
});

test('authenticateRequest passes in AUTH_MODE=off', () => {
  const oldMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'off';
  const sec = createSecurityControls();
  const auth = sec.authenticateRequest({ headers: {}, socket: {} });
  if (oldMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = oldMode;
  assert.equal(auth.ok, true);
  assert.equal(auth.role, 'admin');
});

test('authenticateRequest validates token in AUTH_MODE=on', () => {
  const oldMode = process.env.AUTH_MODE;
  const oldTokens = process.env.AUTH_TOKENS;
  process.env.AUTH_MODE = 'on';
  process.env.AUTH_TOKENS = 'token123:editor,token456:reviewer';
  const sec = createSecurityControls();

  const good = sec.authenticateRequest({ headers: { 'x-api-token': 'token123' }, socket: {} });
  const bad = sec.authenticateRequest({ headers: { 'x-api-token': 'bad' }, socket: {} });

  if (oldMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = oldMode;
  if (oldTokens === undefined) delete process.env.AUTH_TOKENS;
  else process.env.AUTH_TOKENS = oldTokens;

  assert.equal(good.ok, true);
  assert.equal(good.role, 'editor');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
});

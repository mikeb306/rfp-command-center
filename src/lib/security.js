const ROLE_ORDER = ['viewer', 'editor', 'reviewer', 'admin'];

export function createSecurityControls() {
  const authMode = String(process.env.AUTH_MODE || 'off').toLowerCase();
  const tokenMap = parseTokenMap(process.env.AUTH_TOKENS || '');

  const rateLimitMode = String(process.env.RATE_LIMIT_MODE || 'off').toLowerCase();
  const windowSec = clamp(Number(process.env.RATE_LIMIT_WINDOW_SEC || 60), 10, 3600, 60);
  const maxRequests = clamp(Number(process.env.RATE_LIMIT_MAX || 120), 10, 5000, 120);
  const limiter = new InMemoryRateLimiter(windowSec * 1000, maxRequests);

  function authenticateRequest(req) {
    if (authMode !== 'on') {
      return {
        ok: true,
        role: 'admin',
        subject: 'local-dev',
        userName: req.headers['x-user-name'] ? String(req.headers['x-user-name']) : 'local-dev'
      };
    }

    const token = extractToken(req);
    if (!token) {
      return { ok: false, status: 401, error: 'Missing API token.' };
    }

    const role = tokenMap.get(token);
    if (!role) {
      return { ok: false, status: 401, error: 'Invalid API token.' };
    }

    return {
      ok: true,
      role,
      subject: token.slice(0, 8),
      userName: req.headers['x-user-name'] ? String(req.headers['x-user-name']) : token.slice(0, 8)
    };
  }

  function rateLimit(req, auth) {
    if (rateLimitMode !== 'on') return { limited: false };
    const key = `${auth.subject}:${clientIp(req)}`;
    return limiter.check(key);
  }

  return {
    authenticateRequest,
    rateLimit
  };
}

export function hasRequiredRole(role, allowedRoles) {
  const have = ROLE_ORDER.indexOf(role);
  if (have < 0) return false;
  return allowedRoles.some((allowed) => have >= ROLE_ORDER.indexOf(allowed));
}

function parseTokenMap(input) {
  const map = new Map();
  const parts = String(input)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const [token, role] = part.split(':').map((x) => x.trim());
    if (!token || !ROLE_ORDER.includes(role)) continue;
    map.set(token, role);
  }
  return map;
}

function extractToken(req) {
  const headerToken = req.headers['x-api-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' ? remote : 'unknown';
}

function clamp(value, min, max, fallback) {
  if (Number.isNaN(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return Math.round(value);
}

class InMemoryRateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.store = new Map();
  }

  check(key) {
    const now = Date.now();
    const list = this.store.get(key) || [];
    const recent = list.filter((ts) => now - ts < this.windowMs);
    recent.push(now);
    this.store.set(key, recent);
    if (recent.length > this.maxRequests) {
      return {
        limited: true,
        retryAfterSec: Math.ceil(this.windowMs / 1000)
      };
    }
    return { limited: false };
  }
}

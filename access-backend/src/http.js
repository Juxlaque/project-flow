export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function jsonError(res, status, code, message) {
  res.set('cache-control', 'no-store');
  return res.status(status).json({ ok: false, error: code, message });
}

export function bearerToken(req) {
  const header = req.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username ?? null,
    globalName: user.globalName ?? null,
    avatar: user.avatar ?? null,
    banned: Boolean(user.banned),
    devices: Array.isArray(user.devices) ? user.devices.length : 0,
  };
}

import { config, live } from './config.js';
export const origins = [config.origin, ...(!live ? ['http://127.0.0.1:3000'] : [])];
export function allowedRequest(req) {
  // Native clients and local CLI tools omit Origin. Browsers must use our UI.
  if (req.headers.origin && !origins.includes(req.headers.origin)) return false;
  if (!live) {
    let host;
    try {
      host = new URL(`http://${req.headers.host}`).hostname;
    } catch {
      return false;
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
    if (!req.headers.origin && req.headers['sec-fetch-site'] === 'cross-site') return false;
  }
  return true;
}
export function requestSecurity(req, res, next) {
  if (!allowedRequest(req)) return res.status(403).json({ error: 'Request origin is not allowed' });
  res.set('Cache-Control', 'no-store');
  next();
}

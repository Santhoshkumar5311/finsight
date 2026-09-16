import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const api = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
  const auth = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connect = [
    "'self'",
    api.origin,
    api.origin.replace(/^http/, 'ws'),
    ...(auth ? [new URL(auth).origin] : []),
  ];
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect.join(' ')}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    'frame-src https://*.plaid.com',
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js).*)'] };

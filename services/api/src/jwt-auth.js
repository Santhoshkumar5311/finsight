import { jwtVerify } from 'jose';
export async function verifyBankingToken(
  token,
  keys,
  { issuer, audience = 'authenticated', revoked },
) {
  if (!token) throw Object.assign(new Error('Sign in to continue'), { status: 401 });
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['ES256', 'RS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
      typeof payload.exp !== 'number' ||
      typeof payload.session_id !== 'string' ||
      payload.role !== 'authenticated'
    )
      throw new Error('Invalid user');
    if (payload.aal !== 'aal2')
      throw Object.assign(new Error('Complete TOTP verification'), { status: 403 });
    if (await revoked(payload.session_id)) throw new Error('Revoked session');
    return {
      id: payload.sub,
      aal: payload.aal,
      expiresAt: payload.exp * 1000,
      sessionId: payload.session_id,
    };
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error('Session expired or invalid'), { status: 401 });
  }
}

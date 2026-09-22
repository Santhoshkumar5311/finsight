import { readFileSync } from 'node:fs';
export function databaseOptions() {
  const address = new URL(process.env.DATABASE_URL);
  let ssl;
  if (process.env.DATABASE_SSL_CA) {
    for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
      address.searchParams.delete(option);
    ssl = { ca: readFileSync(process.env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  }
  return {
    connectionString: address.toString(),
    ...(ssl ? { ssl } : {}),
    max: 15,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  };
}

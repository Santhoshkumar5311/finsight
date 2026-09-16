import './config.js';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(
    await readFile(new URL('../../../database/001_schema.sql', import.meta.url), 'utf8'),
  );
  console.log('FinSight schema applied');
} finally {
  await pool.end();
}

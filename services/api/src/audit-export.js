import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { pool } from './repository.js';
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
export function startAuditExport() {
  if (!process.env.AUDIT_BUCKET) return () => {};
  let running = false;
  async function batch() {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query(
        'SELECT a.* FROM audit_log a LEFT JOIN audit_exports e ON a.id=e.audit_id WHERE e.audit_id IS NULL ORDER BY a.id LIMIT 100',
      );
      for (const row of rows) {
        const body = JSON.stringify(row);
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AUDIT_BUCKET,
            Key: `audit/${row.id}.json`,
            Body: body,
            ContentType: 'application/json',
            ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: process.env.AWS_KMS_KEY_ID,
            ObjectLockMode: 'GOVERNANCE',
            ObjectLockRetainUntilDate: new Date(Date.now() + 90 * 86400000),
          }),
        );
        await pool.query('INSERT INTO audit_exports(audit_id) VALUES($1) ON CONFLICT DO NOTHING', [
          row.id,
        ]);
      }
    } catch {
      console.error('Audit export unavailable; unexported rows will retry');
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void batch(), 30000);
  timer.unref();
  void batch();
  return () => clearInterval(timer);
}

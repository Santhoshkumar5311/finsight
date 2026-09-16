import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { toFile } from 'openai';
import { ai } from './agent.js';
import { state, saveDiary, audit } from './repository.js';
import { redact } from './security.js';
import { diaryTags, day } from '@finsight/core';
import { live } from './config.js';
import { privateText } from './privacy.js';
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
export async function diaryEntry(user, { text, file }) {
  let transcript = text || '',
    audioKey;
  if (file) {
    if (!ai || !live)
      throw Object.assign(
        new Error(
          'Audio transcription requires live mode with OpenAI and encrypted S3 configured. You can save a written reflection in demo mode.',
        ),
        { status: 503 },
      );
    const audio = await toFile(file.buffer, file.originalname, { type: file.mimetype });
    transcript = (await ai.audio.transcriptions.create({ model: 'whisper-1', file: audio })).text;
  }
  // Persist redacted text; original audio remains private in KMS-encrypted storage.
  transcript = await privateText(transcript.slice(0, 12000));
  if (!transcript.trim())
    throw Object.assign(new Error('No speech or text was found'), { status: 400 });
  const id = randomUUID(),
    s = await state(user);
  let tags = diaryTags(transcript),
    embedding = null;
  if (ai && live) {
    // Send only a closed-vocabulary lexical summary for tags, not unredacted free-form speech.
    const [tagResult, vector] = await Promise.all([
      ai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'Return JSON {"tags":[string]} with 1 to 3 short financial reflection tags based only on the provided topic signals.',
          },
          { role: 'user', content: JSON.stringify({ topics: tags }) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 100,
      }),
      ai.embeddings.create({ model: 'text-embedding-3-small', input: transcript }),
    ]);
    const parsed = JSON.parse(tagResult.choices[0].message.content || '{}');
    if (Array.isArray(parsed.tags))
      tags = parsed.tags.filter((t) => typeof t === 'string' && t.length <= 40).slice(0, 3);
    embedding = vector.data[0].embedding;
  }
  if (file) {
    audioKey = `${user}/${id}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AUDIO_BUCKET,
        Key: audioKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: process.env.AWS_KMS_KEY_ID,
        BucketKeyEnabled: true,
      }),
    );
  }
  const entry = {
    id,
    transcript,
    tags,
    audioKey,
    hasAudio: !!audioKey,
    createdAt: new Date().toISOString(),
    transactionIds: s.transactions.filter((t) => t.date === day()).map((t) => t.id),
  };
  try {
    await saveDiary(user, entry, embedding);
  } catch (e) {
    if (audioKey)
      await s3
        .send(new DeleteObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key: audioKey }))
        .catch(() => {});
    throw e;
  }
  await audit(user, 'diary.created', id);
  const { audioKey: _, ...publicEntry } = entry;
  return publicEntry;
}
export async function audioStream(user, id) {
  const entries = (await state(user)).diaries;
  if (!entries.some((e) => e.id === id && e.hasAudio))
    throw Object.assign(new Error('Audio not found'), { status: 404 });
  await audit(user, 'diary.audio.read', id);
  return s3.send(new GetObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key: `${user}/${id}` }));
}

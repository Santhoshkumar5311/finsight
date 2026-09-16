import { z } from 'zod';
import { live } from './config.js';
import { redact, tokenise } from './security.js';
const entities = z.array(
  z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      entity_type: z.string(),
      score: z.number(),
    })
    .passthrough(),
);
export function maskEntities(text, findings) {
  // Presidio offsets count Unicode code points; JS string offsets count UTF-16 units.
  const chars = Array.from(text),
    ranges = [];
  for (const f of [...findings].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (f.end > chars.length || f.end <= f.start) throw new Error('Invalid PII span');
    const prev = ranges.at(-1);
    if (prev && f.start < prev.end) prev.end = Math.max(prev.end, f.end);
    else ranges.push({ ...f });
  }
  for (const f of ranges.reverse()) {
    const value = chars.slice(f.start, f.end).join('');
    chars.splice(f.start, f.end - f.start, `[${f.entity_type}:${tokenise(value).slice(0, 12)}]`);
  }
  return chars.join('');
}
export async function privateText(text) {
  const safe = redact(text);
  if (!live) return safe;
  // Runs in the user's private data plane. Failure stops processing rather than leaking raw text.
  const response = await fetch(process.env.PII_ANALYZER_URL.replace(/\/$/, '') + '/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: safe, language: 'en', score_threshold: 0.35 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('PII analysis unavailable');
  return maskEntities(safe, entities.parse(await response.json()));
}

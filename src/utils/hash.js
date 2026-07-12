import { createHash } from 'node:crypto';

export function hashKey(input) {
  const hex = createHash('md5').update(input).digest('hex');

  return parseInt(hex.slice(0, 8), 16);
}

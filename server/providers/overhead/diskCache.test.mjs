import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { budgetBytes, createOverheadDiskCache } from './diskCache.js';

test('the cache keeps to its byte budget and age limit, oldest first', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'omh-cache-'));
  try {
    const cache = createOverheadDiskCache({ root, maxBytes: 2500 });
    const blob = 'x'.repeat(900);
    await cache.write('a', { at: 1, value: blob });
    await utimes(path.join(root, 'a.json'), new Date(Date.now() - 5000) / 1000, new Date(Date.now() - 5000) / 1000);
    await cache.write('b', { at: 2, value: blob });
    await cache.write('c', { at: 3, value: blob });
    const names = (await readdir(root)).sort();
    assert.deepEqual(names, ['b.json', 'c.json']);
    assert.equal((await cache.read('c')).at, 3);
    assert.equal(await cache.read('a'), null);
    await assert.doesNotReject(cache.read('../x'));
    assert.equal(await cache.read('../x'), null);
    const usage = await cache.usage();
    assert.ok(usage.bytes <= 2500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the budget comes from OMH_CACHE_MAX_MB within 5-500 MB', () => {
  assert.equal(budgetBytes('100'), 100 * 1024 * 1024);
  assert.equal(budgetBytes('100000'), 60 * 1024 * 1024);
  assert.equal(budgetBytes(undefined), 60 * 1024 * 1024);
});

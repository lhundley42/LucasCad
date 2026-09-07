// Security overrides cross minor API versions; exercise their actual consumers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);

test('Miniflare can load patched sharp and resize/encode a real image', async () => {
  const wrangler = createRequire(require.resolve('wrangler/package.json'));
  const miniflare = createRequire(wrangler.resolve('miniflare'));
  const sharp = miniflare('sharp');
  const png = await sharp({ create: { width: 16, height: 16, channels: 4,
    background: { r: 30, g: 80, b: 120, alpha: 1 } } }).resize(8, 8).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 8);
});

test('Drizzle TypeScript schema loader works with patched esbuild without touching a database', () => {
  const sql = execSync('pnpm exec drizzle-kit export --dialect sqlite --schema examples/d1/db/schema.ts', {
    encoding: 'utf8', timeout: 30000,
  });
  assert.match(sql, /CREATE TABLE [`"]?notes/);
  assert.match(sql, /title/);
});

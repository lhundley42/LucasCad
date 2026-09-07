import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('source archive excludes unapproved owner model and diagnostic exports, not test fixtures or licenses', () => {
  const excluded = ['examples/chalis.json', 'examples/Black-Lantern.step',
    'examples/LucasCoupe-preview.png', 'examples/Sweep-hollow-handle.stl',
    '.venv', 'node_modules', '.env', '.env.local', 'dist', 'artifacts'];
  const included = ['LICENSE', 'LICENSES/OpenAI-create-sites-MIT.txt',
    'THIRD_PARTY_LICENSES.txt', 'examples/Black-Lantern.lucascad.json',
    'examples/LucasCoupe.lucascad.json', 'examples/Sweep-hollow-handle.lucascad.json'];
  for (const [files, value] of [[excluded, 'set'], [included, 'unspecified']]) {
    for (const file of files) {
      const result = execFileSync('git', ['check-attr', 'export-ignore', '--', file], { encoding: 'utf8' });
      assert.equal(result.trim(), `${file}: export-ignore: ${value}`);
    }
  }
});

test('tracked release source contains no local environments, secrets by filename, logs or native executables', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const forbidden = files.filter(file => /(^|\/)(node_modules|\.venv|\.git|\.env[^/]*)(\/|$)/i.test(file)
    || /\.(dll|exe|pyd|so|dylib|pem|key|log)$/i.test(file));
  assert.deepEqual(forbidden, []);
});

test('project and template license scopes remain distinct and owner model is preserved', () => {
  assert.match(readFileSync('LICENSE', 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
  assert.match(readFileSync('LICENSES/OpenAI-create-sites-MIT.txt', 'utf8'), /Copyright \(c\) 2026 OpenAI/);
  assert.ok(JSON.parse(readFileSync('examples/chalis.json', 'utf8')));
  assert.match(readFileSync('docs/release/provenance.md', 'utf8'), /not hide files from GitHub/);
});

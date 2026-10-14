// Сборка расширения для приложения Claude: npm run mcp:pack →
// tools/brain-mcp/dist/schema-brain-<версия>.mcpb (в репозиторий не попадает).
// В архиве — manifest.json и server.mjs; версии в них должны совпадать.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../../skills/vyvody/pack.mjs';
import { VERSION } from './server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.version !== VERSION) {
  throw new Error(`manifest.json: версия ${manifest.version}, а в server.mjs — ${VERSION}`);
}
const entries = Object.fromEntries(
  ['manifest.json', 'server.mjs'].map((name) => [name, new Uint8Array(readFileSync(join(root, name)))]),
);
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });
const target = join(out, `schema-brain-${VERSION}.mcpb`);
writeFileSync(target, zip(entries));
console.log(`Расширение собрано: ${relative(process.cwd(), target)}`);

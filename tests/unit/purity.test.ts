import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../src/', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(join(root, dir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts')).map((e) => join(e.parentPath, e.name));

describe('indépendance du moteur et de la navigation', () => {
  const sources = [...files('engine'), ...files('nav')].map((f) => ({ f, text: readFileSync(f, 'utf8') }));

  it('aucun alea ni horloge murale dans l’état : pas de Math.random ni Date.now', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/Math\.random\s*\(/);
      expect(text, f).not.toMatch(/Date\.now\s*\(/);
    }
  });

  it('aucune dépendance à la carte, au DOM ni à l’interface', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/maplibre/i);
      expect(text, f).not.toMatch(/from '\.\.\/(ui|render|map|app)\//);
      expect(text, f).not.toMatch(/\b(document|window|localStorage)\./);
    }
  });

  it('les positions du moteur sont en mètres locaux : aucun import de la projection écran', () => {
    for (const { f, text } of [...files('engine')].map((f) => ({ f, text: readFileSync(f, 'utf8') }))) {
      expect(text, f).not.toMatch(/\b(project|unproject|lngLatToWorld)\b\s*\(/);
    }
  });
});

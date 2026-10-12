import { writeFileSync } from 'node:fs';
import { paramsMarkdown } from '../src/engine/paramDocs';

writeFileSync(new URL('../docs/PARAMETRES.md', import.meta.url), paramsMarkdown());
console.log('docs/PARAMETRES.md généré');

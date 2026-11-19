import fs from 'node:fs';
import path from 'node:path';
import { assertPolicyId, containedPath } from './safe-path.mjs';

const CORE = ['core/basic-engineering', 'core/git-safety', 'core/delivery-evidence'];
const STACK_PACKS = { nextjs: 'frontend/nextjs', react: 'frontend/react', typescript: 'frontend/typescript', tailwind: 'frontend/tailwind', shadcn: 'frontend/shadcn' };

export function resolvePolicyPacks({ size = 'small', stack = {}, ui = {}, explicit = [] } = {}) {
  for(const id of explicit)assertPolicyId(id);
  const packs = [...CORE, `size/${size}`];
  for (const [key, pack] of Object.entries(STACK_PACKS)) if (stack[key]) packs.push(pack);
  if (ui.primarySkill === 'finesse-ui') packs.push(`ui/finesse-${ui.register ?? 'product'}`);
  else if (ui.primarySkill === 'finesse-brief') packs.push('ui/finesse-brief');
  else if (ui.primarySkill === 'design-review') packs.push('ui/design-review');
  return [...new Set([...packs, ...explicit])];
}

export function loadPolicyPack(packRoot, ids) {
  return ids.map(id => {
    assertPolicyId(id);
    const file = containedPath(packRoot, `${id}.md`);
    if (!fs.existsSync(file)) return { id, available: false, file };
    return { id, available: true, file, content: fs.readFileSync(file, 'utf8') };
  });
}

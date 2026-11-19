import {join} from 'node:path';
import {validImageReference} from '../../localization-engine';
import {SelectionStore} from './store';

/** Existing imported references only; never fetches remote images or mutates a source/draft. */
export function productReferenceImages(product: {image?: unknown}): string[] {
  return [...new Set([product.image].filter((url): url is string => typeof url === 'string'
    && url.startsWith('https://') && validImageReference(url)))].slice(0, 9);
}

/** dir is LocalizationEngine.dir, not its selection subdirectory. */
export function selectionReferenceImages(dir: string, owner: string): Map<string, string[]> {
  const store = new SelectionStore(join(dir, 'selection'));
  const result = new Map<string, string[]>();
  for (const origin of store.list<{sourceId: string; product: {image?: unknown}}>(owner, 'origins')) {
    if (!result.has(origin.sourceId)) result.set(origin.sourceId, productReferenceImages(origin.product));
  }
  return result;
}

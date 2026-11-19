import fs from 'node:fs';
import path from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const POLICY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,5}$/;

export function assertSafeId(value, label = 'id') {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') throw new Error(`Invalid ${label}: ${value ?? ''}`);
  return value;
}

export function assertPolicyId(value) {
  if (typeof value !== 'string' || !POLICY.test(value)) throw new Error(`Invalid policy id: ${value ?? ''}`);
  return value;
}

export function containedPath(root, ...parts) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error(`Path escapes root: ${target}`);
  return target;
}

export function safeContainedPath(root,...parts){const target=containedPath(root,...parts),base=path.resolve(root),relative=path.relative(base,target).split(path.sep).filter(Boolean);let current=base;for(const part of relative){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error(`Symlink traversal is not allowed: ${current}`);}return target;}

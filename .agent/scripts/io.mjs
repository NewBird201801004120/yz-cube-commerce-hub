import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function exists(file) { return fs.existsSync(file); }
export function run(cmd, args, cwd, options = {}) {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
  catch (error) {
    if (options.allowFailure) return '';
    const stderr = error.stderr?.toString().trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}
export function walk(dir, maxDepth = 4, depth = 0, out = []) {
  if (!fs.existsSync(dir) || depth > maxDepth) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next', 'dist', 'out', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, maxDepth, depth + 1, out); else out.push(full);
  }
  return out;
}
export function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }

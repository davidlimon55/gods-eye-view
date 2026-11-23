import path from 'node:path';
import { promises as fsp } from 'node:fs';

/** Default size budget for this feature's own cache folder. */
export const OVERHEAD_CACHE_DEFAULT_MB = 60;
/** Files older than this are removed even when the budget is not reached. */
export const OVERHEAD_CACHE_MAX_AGE_MS = 14 * 86400000;

/**
 * A small JSON file cache in its own folder under .gev-cache, with a size
 * budget and age limit. It never touches files outside its folder, and file
 * names are fixed keys from this feature, never request input.
 */
export function createOverheadDiskCache({
  root = path.join(process.cwd(), '.gev-cache', 'overhead'),
  maxBytes = budgetBytes(process.env.OMH_CACHE_MAX_MB),
  now = () => Date.now(),
} = {}) {
  const fileFor = (key) => {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) throw new Error('bad cache key');
    return path.join(root, `${key}.json`);
  };

  async function read(key) {
    try {
      const file = fileFor(key);
      const stat = await fsp.stat(file);
      if (stat.size > maxBytes) return null;
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
      return Number.isFinite(parsed?.at) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function write(key, entry) {
    try {
      await fsp.mkdir(root, { recursive: true });
      const file = fileFor(key);
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(entry), 'utf8');
      await fsp.rename(tmp, file);
      await enforce();
      return true;
    } catch {
      console.warn('[over-my-house] cache write failed');
      return false;
    }
  }

  /** Files in the folder with size and time, oldest first. */
  async function list() {
    let names = [];
    try {
      names = await fsp.readdir(root);
    } catch {
      return [];
    }
    const files = [];
    for (const name of names) {
      if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
      try {
        const stat = await fsp.stat(path.join(root, name));
        if (stat.isFile())
          files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        /* removed meanwhile */
      }
    }
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  /** Remove stale files, then the oldest ones until the folder fits its budget. */
  async function enforce() {
    const files = await list();
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const removed = [];
    for (const file of files) {
      const old = now() - file.mtimeMs > OVERHEAD_CACHE_MAX_AGE_MS;
      if (!old && total <= maxBytes) continue;
      try {
        await fsp.rm(path.join(root, file.name), { force: true });
        total -= file.size;
        removed.push(file.name);
      } catch {
        /* keep going */
      }
    }
    return { totalBytes: total, removed };
  }

  async function usage() {
    const files = await list();
    return {
      folder: path.relative(process.cwd(), root) || root,
      files: files.length,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      budgetBytes: maxBytes,
    };
  }

  return { read, write, enforce, usage, root, maxBytes };
}

/** Budget from an env value in MB (5-500), else the default. */
export function budgetBytes(value) {
  const mb = Number(value);
  const safe =
    Number.isFinite(mb) && mb >= 5 && mb <= 500
      ? mb
      : OVERHEAD_CACHE_DEFAULT_MB;
  return Math.round(safe * 1024 * 1024);
}

/** Total size of a folder tree (bounded walk), for the status line. */
export async function folderBytes(dir, { maxEntries = 20000 } = {}) {
  let total = 0;
  let seen = 0;
  const walk = async (d, depth) => {
    if (depth > 4 || seen > maxEntries) return;
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p, depth + 1);
      else if (entry.isFile()) {
        try {
          total += (await fsp.stat(p)).size;
        } catch {
          /* gone */
        }
      }
    }
  };
  await walk(dir, 0);
  return total;
}

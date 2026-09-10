import 'server-only';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import type { PutObjectInput, StorageDriver } from './types';

/**
 * Local filesystem storage driver. Files live under STORAGE_LOCAL_DIR (relative
 * to the working directory, so it is portable across Windows dev and Ubuntu).
 *
 * SECURITY: keys are validated to be safe relative POSIX paths and the resolved
 * absolute path is confirmed to stay inside the storage root, defeating `../`
 * traversal and absolute-path escapes even if a bad key ever reaches the driver.
 */
function storageRoot(): string {
  return path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
}

/** Validates a storage key and resolves it to an absolute path inside the root. */
function resolveKey(key: string): string {
  if (!key || typeof key !== 'string') throw new AppError('VALIDATION', 'Invalid storage key.');
  // Reject absolute paths, drive letters, backslashes and traversal segments.
  if (path.isAbsolute(key) || /^[a-zA-Z]:/.test(key) || key.includes('\\') || key.includes('\0')) {
    throw new AppError('VALIDATION', 'Invalid storage key.');
  }
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new AppError('VALIDATION', 'Invalid storage key.');
  }
  const root = storageRoot();
  const resolved = path.resolve(root, key);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('VALIDATION', 'Invalid storage key.');
  }
  return resolved;
}

export const localFilesystemStorageDriver: StorageDriver = {
  name: 'local',

  async put({ key, data }: PutObjectInput): Promise<void> {
    const target = resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  },

  async get(key: string): Promise<Buffer> {
    const target = resolveKey(key);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', 'The stored file could not be found.', { status: 404 });
      }
      throw error;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await access(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await unlink(resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },
};

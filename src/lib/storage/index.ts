import 'server-only';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import { localFilesystemStorageDriver } from './local-driver';
import type { StorageDriver } from './types';

export type { StorageDriver, PutObjectInput } from './types';

/**
 * Returns the configured storage driver. Only the local filesystem driver is
 * implemented in Phase 11A; `supabase`/`s3` are recognized config values but
 * deferred (S3-compatible storage is Phase 11B) — selecting them fails loudly
 * rather than silently doing nothing.
 */
export function getStorage(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return localFilesystemStorageDriver;
    default:
      throw new AppError(
        'INTERNAL',
        `Storage driver "${env.STORAGE_DRIVER}" is not available in this deployment. Set STORAGE_DRIVER=local.`,
        { status: 500 },
      );
  }
}

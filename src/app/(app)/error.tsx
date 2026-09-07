'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary. Shows a friendly message — never a raw stack
 * trace (BRD 69) — and logs the digest for support.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route-error]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--color-error-soft)] text-[var(--color-error)]">
        <AlertTriangle className="size-7" aria-hidden />
      </div>
      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">Something went wrong</h1>
      <p className="mt-1 max-w-md text-[13px] text-[var(--color-text-secondary)]">
        The page could not be loaded. The issue has been logged. You can try again or return to the dashboard.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-text-tertiary)]">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-5 flex gap-2">
        <Button onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
        <Button variant="secondary" asChild>
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>
    </div>
  );
}

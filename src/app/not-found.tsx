import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { RiftaraLogo } from '@/components/app/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[var(--color-canvas)] px-6 text-center">
      <RiftaraLogo tone="dark" subtitle="ENTERPRISE PLATFORM" />
      <div>
        <p className="text-[64px] font-bold leading-none text-[var(--color-espresso-200)]">404</p>
        <h1 className="mt-2 text-[20px] font-semibold text-[var(--color-text-primary)]">Page not found</h1>
        <p className="mt-1 max-w-sm text-[13px] text-[var(--color-text-secondary)]">
          The page you are looking for does not exist or you do not have access to it.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}

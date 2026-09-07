'use client';

import { Globe, GlobeLock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Publish / unpublish toggle for a unit. BR-001 is enforced server-side; this
 * control surfaces the rejection as a toast rather than assuming success.
 */
export function UnitPublishControl({
  unitId,
  publicationState,
  availabilityClass,
}: {
  unitId: string;
  publicationState: string;
  availabilityClass: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(publicationState);
  const isPublished = state !== 'unpublished';

  async function toggle() {
    const action = isPublished ? 'unpublish' : 'publish';
    const response = await fetch(`/api/v1/units/${unitId}/${action}`, { method: 'POST' });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      toast.error(body?.error?.message ?? 'The action could not be completed.');
      return;
    }

    setState(isPublished ? 'unpublished' : 'published');
    toast.success(isPublished ? 'Unit unpublished from the website.' : 'Unit published to the website.');
    startTransition(() => router.refresh());
  }

  return (
    <Button
      variant={isPublished ? 'secondary' : 'primary'}
      loading={pending}
      onClick={() => void toggle()}
      title={
        !isPublished && availabilityClass === 'not_available'
          ? 'This unit status is not eligible for publication (BR-001).'
          : undefined
      }
    >
      {isPublished ? <GlobeLock /> : <Globe />}
      {isPublished ? 'Unpublish' : 'Publish to Website'}
    </Button>
  );
}

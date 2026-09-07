'use client';

import { FileSignature } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Sign & activate a contract. This is an irreversible action (it generates the
 * payment schedule and invoices), so it confirms first (BR-010).
 */
export function SignContractButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function sign() {
    const response = await fetch(`/api/v1/contracts/${contractId}/sign`, { method: 'POST' });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      toast.error(body?.error?.message ?? 'The contract could not be signed.');
      return;
    }

    toast.success(
      `Contract signed. ${body?.data?.scheduleCount ?? 0} instalments scheduled, ${body?.data?.invoiceCount ?? 0} invoices issued.`,
    );
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileSignature />
          Sign &amp; Activate
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          title="Sign and activate contract"
          description="This sets the unit to Leased, generates the payment schedule and issues due invoices. The action cannot be undone."
        />
        <DialogBody>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Confirm that all approvals, deposits and documents are in order before signing.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void sign()} loading={pending}>
            Sign &amp; Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

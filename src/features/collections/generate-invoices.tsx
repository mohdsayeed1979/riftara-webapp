'use client';

import { FileText, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { generateDueInvoicesAction, generateInvoiceAction } from '@/app/(app)/collections/actions';

/** Bulk-generate invoices for every due, un-invoiced installment in scope. */
export function GenerateDueButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await generateDueInvoicesAction();
          if (result.ok) {
            toast.success(
              result.data.generated > 0
                ? `${result.data.generated} invoice(s) generated.`
                : 'No due installments to invoice.',
            );
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <Zap />
      Generate Due Invoices
    </Button>
  );
}

/** Generate one invoice from a single payment-schedule installment. */
export function GenerateInvoiceButton({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await generateInvoiceAction(scheduleId);
          if (result.ok) {
            toast.success(
              result.data.alreadyExisted
                ? `Invoice ${result.data.invoiceNumber} already exists.`
                : `Invoice ${result.data.invoiceNumber} generated.`,
            );
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <FileText />
      Generate
    </Button>
  );
}

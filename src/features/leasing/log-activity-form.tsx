'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
];

/** Inline follow-up logger for a lead (BRD 26-27). */
export function LogActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activityType, setActivityType] = useState('call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [nextAction, setNextAction] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim()) {
      toast.error('Enter a subject for the activity.');
      return;
    }

    const response = await fetch(`/api/v1/leads/${leadId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityType,
        subject: subject.trim(),
        body: body.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast.error(payload?.error?.message ?? 'The activity could not be saved.');
      return;
    }

    toast.success('Activity logged.');
    setSubject('');
    setBody('');
    setNextAction('');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Type">
        <Select value={activityType} onValueChange={setActivityType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Subject" required>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Discussed pricing and terms" />
      </Field>

      <Field label="Notes">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Outcome and details..." />
      </Field>

      <Field label="Next Action" hint="Keep an active lead moving with a clear next step.">
        <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Send revised proposal" />
      </Field>

      <Button type="submit" loading={pending} size="sm">
        Log activity
      </Button>
    </form>
  );
}

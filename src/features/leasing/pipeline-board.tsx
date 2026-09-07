'use client';

import { Clock, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';
import type { PipelineCard, PipelineColumn } from '@/services/lead-service';

const COLUMN_TONE: Record<string, string> = {
  info: 'text-[var(--color-info)]',
  warning: 'text-[#b97a08]',
  success: 'text-[var(--color-success)]',
  gold: 'text-[var(--color-gold-700)]',
  error: 'text-[var(--color-error)]',
};

const SOURCE_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral' | 'gold'> = {
  'Corporate Website': 'info',
  'Google Ads': 'warning',
  LinkedIn: 'info',
  Referral: 'warning',
  TikTok: 'neutral',
};

/**
 * Kanban pipeline board (BRD 19). Cards are draggable between stages; a drop
 * calls the move API. BR-006 (loss reason) is enforced server-side — a drop to
 * a lost stage without a reason surfaces the rejection and reverts.
 */
export function PipelineBoard({
  columns: initialColumns,
  canEdit,
  locale,
}: {
  columns: PipelineColumn[];
  canEdit: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [columns, setColumns] = useState(initialColumns);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  function findCard(id: string): { card: PipelineCard; stageKey: string } | null {
    for (const column of columns) {
      const card = column.cards.find((c) => c.id === id);
      if (card) return { card, stageKey: column.stageKey };
    }
    return null;
  }

  async function moveCard(cardId: string, toStageKey: string) {
    const found = findCard(cardId);
    if (!found || found.stageKey === toStageKey) return;

    // Optimistic update.
    const previous = columns;
    setColumns((current) =>
      current.map((column) => {
        if (column.stageKey === found.stageKey) {
          return { ...column, cards: column.cards.filter((c) => c.id !== cardId), count: column.count - 1 };
        }
        if (column.stageKey === toStageKey) {
          return { ...column, cards: [found.card, ...column.cards], count: column.count + 1 };
        }
        return column;
      }),
    );

    const response = await fetch(`/api/v1/leads/${cardId}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageKey: toStageKey, nextAction: 'Follow up on stage change' }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setColumns(previous);
      toast.error(body?.error?.message ?? 'The lead could not be moved.');
      return;
    }

    toast.success('Lead stage updated.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
      {columns.map((column) => (
        <div
          key={column.stageKey}
          onDragOver={(event) => {
            if (canEdit) {
              event.preventDefault();
              setOverStage(column.stageKey);
            }
          }}
          onDragLeave={() => setOverStage((current) => (current === column.stageKey ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            setOverStage(null);
            if (draggingId) void moveCard(draggingId, column.stageKey);
          }}
          className={cn(
            'flex w-[272px] shrink-0 flex-col rounded-[var(--radius-card)] border bg-[var(--color-surface-muted)]/60 transition-colors',
            overStage === column.stageKey
              ? 'border-[var(--color-gold-400)] bg-[var(--color-gold-50)]'
              : 'border-[var(--color-border-base)]',
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border-base)] px-3 py-2.5">
            <span className={cn('text-[13px] font-semibold', COLUMN_TONE[column.colorToken] ?? 'text-[var(--color-text-primary)]')}>
              {column.label}
            </span>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] tabular">
              {column.count}
            </span>
          </div>

          <div className="no-scrollbar flex max-h-[calc(100vh-360px)] flex-col gap-2 overflow-y-auto p-2">
            {column.cards.length === 0 ? (
              <p className="px-2 py-6 text-center text-[11.5px] text-[var(--color-text-tertiary)]">
                No leads
              </p>
            ) : (
              column.cards.map((card) => (
                <Link
                  key={card.id}
                  href={`/leasing/leads/${card.id}`}
                  draggable={canEdit}
                  onDragStart={() => setDraggingId(card.id)}
                  onDragEnd={() => setDraggingId(null)}
                  className={cn(
                    'block rounded-[10px] border border-[var(--color-border-base)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]',
                    canEdit && 'cursor-grab active:cursor-grabbing',
                    draggingId === card.id && 'opacity-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
                      {card.companyName ?? card.customerName}
                    </span>
                    {card.priority === 'high' ? (
                      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--color-error)]" title="High priority" />
                    ) : null}
                  </div>
                  {card.usageType ? (
                    <p className="mt-0.5 text-[11px] capitalize text-[var(--color-text-secondary)]">
                      {card.usageType} space
                    </p>
                  ) : null}
                  {card.propertyName ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
                      <MapPin className="size-3" aria-hidden />
                      {card.propertyName}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between">
                    {card.sourceName ? (
                      <Badge tone={SOURCE_TONE[card.sourceName] ?? 'neutral'} size="sm">
                        {card.sourceName}
                      </Badge>
                    ) : (
                      <span className="flex items-center gap-1 text-[10.5px] text-[var(--color-text-tertiary)]">
                        <Clock className="size-3" aria-hidden />
                        {formatRelativeTime(card.createdAt, { locale })}
                      </span>
                    )}
                    {card.assignedInitials ? (
                      <Avatar name={card.assignedInitials} size="xs" />
                    ) : null}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

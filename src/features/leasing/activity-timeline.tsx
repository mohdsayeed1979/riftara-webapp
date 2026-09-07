import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

export interface TimelineActivity {
  id: string;
  activityType: string;
  subject: string;
  body: string | null;
  outcome: string | null;
  occurredAt: string;
}

const ICON_BY_TYPE: Record<string, { icon: ComponentType<{ className?: string }>; tone: string }> = {
  call: { icon: Phone, tone: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]' },
  whatsapp: { icon: MessageCircle, tone: 'bg-[var(--color-success-soft)] text-[var(--color-success)]' },
  email: { icon: Mail, tone: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  meeting: { icon: Users, tone: 'bg-[var(--color-gold-100)] text-[var(--color-gold-700)]' },
  viewing: { icon: CalendarClock, tone: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  note: { icon: NotebookPen, tone: 'bg-[var(--color-neutral-soft)] text-[var(--color-text-secondary)]' },
  stage_change: { icon: CheckCircle2, tone: 'bg-[var(--color-espresso-100)] text-[var(--color-espresso-700)]' },
  proposal: { icon: FileText, tone: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  system: { icon: CheckCircle2, tone: 'bg-[var(--color-neutral-soft)] text-[var(--color-text-secondary)]' },
};

/** Vertical timeline of customer/lead activities (BRD 21, 27). */
export function ActivityTimeline({
  activities,
  locale,
}: {
  activities: TimelineActivity[];
  locale: Locale;
}) {
  return (
    <ol className="relative">
      {activities.map((activity, index) => {
        const config = ICON_BY_TYPE[activity.activityType] ?? ICON_BY_TYPE.system;
        const Icon = config.icon;
        const isLast = index === activities.length - 1;

        return (
          <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span className="absolute start-4 top-8 h-full w-px bg-[var(--color-border-subtle)]" aria-hidden />
            ) : null}
            <span className={cn('z-10 flex size-8 shrink-0 items-center justify-center rounded-full', config.tone)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-medium text-[var(--color-text-primary)]">{activity.subject}</p>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--color-text-tertiary)]">
                  {formatRelativeTime(activity.occurredAt, { locale })}
                </span>
              </div>
              {activity.body ? (
                <p className="mt-0.5 text-[11.5px] leading-4 text-[var(--color-text-secondary)]">{activity.body}</p>
              ) : null}
              {activity.outcome ? (
                <p className="mt-1 text-[11px] font-medium text-[var(--color-success)]">{activity.outcome}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

'use client';

import { CalendarClock, History, MoreVertical, Play, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  REPORT_CATALOG,
  REPORT_PERIODS,
  type ReportFrequency,
  type ReportPeriod,
  type ReportTypeKey,
} from '@/lib/reports/catalog';
import { useTranslations } from '@/i18n/provider';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import {
  createScheduleAction,
  deleteScheduleAction,
  getScheduleHistoryAction,
  runScheduleNowAction,
  setScheduleActiveAction,
  updateScheduleAction,
} from '@/app/(app)/reports/actions';

export interface ScheduleView {
  id: string;
  name: string;
  reportType: string;
  frequency: string;
  hour: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  config: { period?: string; propertyId?: string | null; commentary?: string | null };
}

interface HistoryRow {
  id: string;
  status: string;
  reportType: string;
  durationMs: number | null;
  reportRunId: string | null;
  failureMessage: string | null;
  createdAt: string | Date;
}

const REPORT_LABEL = new Map(REPORT_CATALOG.map((r) => [r.key, r.label]));

interface FormState {
  id?: string;
  name: string;
  reportType: ReportTypeKey;
  frequency: ReportFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  timezone: string;
  period: ReportPeriod;
  propertyId: string;
  commentary: string;
}

function emptyForm(defaultTimezone: string): FormState {
  return {
    name: '',
    reportType: 'portfolio_summary',
    frequency: 'monthly',
    hour: 3,
    dayOfWeek: 1,
    dayOfMonth: 1,
    timezone: defaultTimezone,
    period: '12m',
    propertyId: '__all__',
    commentary: '',
  };
}

export function ScheduleManager({
  schedules,
  properties,
  defaultTimezone,
  canManage,
  locale,
}: {
  schedules: ScheduleView[];
  properties: Array<{ id: string; name: string }>;
  defaultTimezone: string;
  canManage: boolean;
  locale: Locale;
}) {
  const t = useTranslations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(defaultTimezone));
  const [pending, startTransition] = useTransition();
  const [historyFor, setHistoryFor] = useState<ScheduleView | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  function openCreate() {
    setForm(emptyForm(defaultTimezone));
    setDialogOpen(true);
  }

  function openEdit(s: ScheduleView) {
    setForm({
      id: s.id,
      name: s.name,
      reportType: s.reportType as ReportTypeKey,
      frequency: s.frequency as ReportFrequency,
      hour: s.hour,
      dayOfWeek: s.dayOfWeek ?? 1,
      dayOfMonth: s.dayOfMonth ?? 1,
      timezone: s.timezone,
      period: (s.config.period as ReportPeriod) ?? '12m',
      propertyId: s.config.propertyId ?? '__all__',
      commentary: s.config.commentary ?? '',
    });
    setDialogOpen(true);
  }

  function submit() {
    const payload = {
      name: form.name.trim(),
      reportType: form.reportType,
      frequency: form.frequency,
      hour: form.hour,
      dayOfWeek: form.frequency === 'weekly' ? form.dayOfWeek : null,
      dayOfMonth: form.frequency === 'monthly' ? form.dayOfMonth : null,
      timezone: form.timezone,
      config: {
        period: form.period,
        propertyId: form.propertyId === '__all__' ? null : form.propertyId,
        commentary: form.commentary.trim() || null,
      },
    };
    startTransition(async () => {
      const result = form.id
        ? await updateScheduleAction(form.id, payload)
        : await createScheduleAction(payload);
      if (result.ok) {
        toast.success(form.id ? t('reports.schedules.updated') : t('reports.schedules.created'));
        setDialogOpen(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function toggleActive(s: ScheduleView) {
    startTransition(async () => {
      const result = await setScheduleActiveAction(s.id, !s.isActive);
      if (!result.ok) toast.error(result.error.message);
    });
  }

  function runNow(s: ScheduleView) {
    startTransition(async () => {
      const result = await runScheduleNowAction(s.id);
      if (result.ok) {
        if (result.data.status === 'success') toast.success(t('reports.schedules.runQueued'));
        else toast.error(t('reports.schedules.runFailed'));
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function remove(s: ScheduleView) {
    if (!window.confirm(t('reports.schedules.confirmDelete'))) return;
    startTransition(async () => {
      const result = await deleteScheduleAction(s.id);
      if (result.ok) toast.success(t('reports.schedules.deleted'));
      else toast.error(result.error.message);
    });
  }

  function openHistory(s: ScheduleView) {
    setHistoryFor(s);
    setHistory(null);
    startTransition(async () => {
      const result = await getScheduleHistoryAction(s.id);
      setHistory(result.ok ? (result.data as HistoryRow[]) : []);
    });
  }

  const showDay = form.frequency === 'weekly';
  const showDom = form.frequency === 'monthly';

  return (
    <Card>
      <CardHeader
        title={t('reports.schedules.title')}
        description={t('reports.schedules.description')}
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus /> {t('reports.schedules.newSchedule')}
            </Button>
          ) : null
        }
      />

      {schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title={t('reports.schedules.title')} description={t('reports.schedules.empty')} />
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>{t('reports.schedules.name')}</TH>
                <TH>{t('reports.reportType')}</TH>
                <TH>{t('reports.schedules.frequency')}</TH>
                <TH>{t('reports.schedules.nextRun')}</TH>
                <TH>{t('reports.schedules.status')}</TH>
                <TH alignment="end">{t('reports.schedules.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {schedules.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD>{REPORT_LABEL.get(s.reportType as ReportTypeKey) ?? s.reportType}</TD>
                  <TD className="capitalize">{t(`reports.schedules.${s.frequency}`)}</TD>
                  <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">
                    {formatDateTime(new Date(s.nextRunAt), { locale })}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge
                        status={s.isActive ? 'active' : 'paused'}
                        label={s.isActive ? t('reports.schedules.active') : t('reports.schedules.paused')}
                      />
                      {s.lastStatus ? (
                        <Badge tone={s.lastStatus === 'success' ? 'success' : 'error'} size="sm" dot={false}>
                          {s.lastStatus === 'success' ? t('reports.schedules.succeeded') : t('reports.schedules.failed')}
                        </Badge>
                      ) : null}
                    </div>
                  </TD>
                  <TD alignment="end">
                    <div className="flex items-center justify-end gap-1">
                      {canManage ? (
                        <Button size="icon-sm" variant="ghost" title={t('reports.schedules.runNow')} onClick={() => runNow(s)} loading={pending}>
                          <Play />
                        </Button>
                      ) : null}
                      <Button size="icon-sm" variant="ghost" title={t('reports.schedules.viewHistory')} onClick={() => openHistory(s)}>
                        <History />
                      </Button>
                      {canManage ? (
                        <RowMenu
                          onEdit={() => openEdit(s)}
                          onToggle={() => toggleActive(s)}
                          onDelete={() => remove(s)}
                          toggleLabel={s.isActive ? t('reports.schedules.disable') : t('reports.schedules.enable')}
                          editLabel={t('reports.schedules.editSchedule')}
                          deleteLabel={t('reports.schedules.delete')}
                        />
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}

      <p className="px-5 pb-4 pt-2 text-[11.5px] text-[var(--color-text-tertiary)]">{t('reports.schedules.deliveryNote')}</p>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader title={form.id ? t('reports.schedules.editSchedule') : t('reports.schedules.newSchedule')} />
          <DialogBody className="flex flex-col gap-3">
            <Field label={t('reports.schedules.name')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
              />
            </Field>
            <Field label={t('reports.reportType')}>
              <NativeSelect
                value={form.reportType}
                onChange={(v) => setForm({ ...form, reportType: v as ReportTypeKey })}
                options={REPORT_CATALOG.map((r) => ({ value: r.key, label: r.label }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('reports.schedules.frequency')}>
                <NativeSelect
                  value={form.frequency}
                  onChange={(v) => setForm({ ...form, frequency: v as ReportFrequency })}
                  options={[
                    { value: 'daily', label: t('reports.schedules.daily') },
                    { value: 'weekly', label: t('reports.schedules.weekly') },
                    { value: 'monthly', label: t('reports.schedules.monthly') },
                  ]}
                />
              </Field>
              <Field label={t('reports.schedules.hour')}>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={form.hour}
                  onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}
                  className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
                />
              </Field>
            </div>
            {showDay ? (
              <Field label={t('reports.schedules.dayOfWeek')}>
                <NativeSelect
                  value={String(form.dayOfWeek)}
                  onChange={(v) => setForm({ ...form, dayOfWeek: Number(v) })}
                  options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({ value: String(i), label: d }))}
                />
              </Field>
            ) : null}
            {showDom ? (
              <Field label={t('reports.schedules.dayOfMonth')}>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
                  className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
                />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('reports.timePeriod')}>
                <NativeSelect
                  value={form.period}
                  onChange={(v) => setForm({ ...form, period: v as ReportPeriod })}
                  options={REPORT_PERIODS.map((p) => ({ value: p, label: p.toUpperCase() }))}
                />
              </Field>
              <Field label={t('reports.schedules.timezone')}>
                <input
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
                />
              </Field>
            </div>
            <Field label={t('reports.schedules.scope')}>
              <NativeSelect
                value={form.propertyId}
                onChange={(v) => setForm({ ...form, propertyId: v })}
                options={[{ value: '__all__', label: t('reports.schedules.entirePortfolio') }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
            <Field label={t('reports.executiveCommentary')}>
              <textarea
                value={form.commentary}
                onChange={(e) => setForm({ ...form, commentary: e.target.value })}
                rows={2}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 py-2 text-[13px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">{t('reports.schedules.cancel')}</Button>
            </DialogClose>
            <Button size="sm" onClick={submit} loading={pending} disabled={!form.name.trim()}>
              {t('reports.schedules.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyFor !== null} onOpenChange={(open) => !open && setHistoryFor(null)}>
        <DialogContent size="lg">
          <DialogHeader title={t('reports.schedules.historyTitle')} description={historyFor?.name} />
          <DialogBody>
            {history === null ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">…</p>
            ) : history.length === 0 ? (
              <EmptyState icon={<History />} title={t('reports.schedules.historyTitle')} description={t('reports.schedules.noHistory')} />
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('reports.schedules.status')}</TH>
                      <TH>{t('reports.schedules.duration')}</TH>
                      <TH alignment="end">{t('reports.schedules.lastRun')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {history.map((h) => (
                      <TR key={h.id}>
                        <TD>
                          <Badge tone={h.status === 'success' ? 'success' : 'error'} size="sm">
                            {h.status === 'success' ? t('reports.schedules.succeeded') : t('reports.schedules.failed')}
                          </Badge>
                          {h.failureMessage ? (
                            <span className="ms-2 text-[12px] text-[var(--color-text-tertiary)]">{h.failureMessage}</span>
                          ) : null}
                        </TD>
                        <TD className="text-[var(--color-text-secondary)]">{h.durationMs != null ? `${h.durationMs} ms` : '—'}</TD>
                        <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                          {formatDateTime(new Date(h.createdAt), { locale })}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RowMenu({
  onEdit,
  onToggle,
  onDelete,
  toggleLabel,
  editLabel,
  deleteLabel,
}: {
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  toggleLabel: string;
  editLabel: string;
  deleteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="icon-sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <MoreVertical />
      </Button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-50 mt-1 w-40 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-overlay)]">
            {[
              { label: editLabel, fn: onEdit },
              { label: toggleLabel, fn: onToggle },
              { label: deleteLabel, fn: onDelete, danger: true },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.fn();
                }}
                className={`block w-full px-3 py-1.5 text-start text-[13px] hover:bg-[var(--color-surface-alt)] ${item.danger ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

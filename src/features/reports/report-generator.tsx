'use client';

import { ArrowRight, FileText } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const REPORT_TYPES = [
  { value: 'portfolio_summary', label: 'Executive Portfolio Report' },
  { value: 'financial_performance', label: 'Financial Performance' },
  { value: 'occupancy', label: 'Occupancy Report' },
  { value: 'collections', label: 'Collections Report' },
  { value: 'maintenance', label: 'Maintenance Report' },
  { value: 'leasing', label: 'Leasing Activity' },
  { value: 'property_ranking', label: 'Property Ranking' },
];

const PERIODS = [
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'ytd', label: 'Year to date' },
];

/**
 * Executive report generator (BRD 112). Streams the generated PDF to the
 * browser and refreshes the history list.
 */
export function ReportGenerator({
  allProperties,
}: {
  // Kept flexible so the page can pass its option sets without over-coupling.
  properties?: unknown;
  propertyOptions?: unknown;
  allProperties: Array<{ id: string; name: string }>;
}) {
  const [reportType, setReportType] = useState('portfolio_summary');
  const [period, setPeriod] = useState('12m');
  const [propertyId, setPropertyId] = useState('__all__');
  const [commentary, setCommentary] = useState('');
  const [pending, startTransition] = useTransition();

  async function generate() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportType,
            period,
            propertyId: propertyId === '__all__' ? undefined : propertyId,
            commentary: commentary.trim() || undefined,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          toast.error(body?.error?.message ?? 'The report could not be generated.');
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = response.headers.get('X-Report-Filename') ?? 'riftara-report.pdf';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast.success('Report generated and downloaded.');
      } catch {
        toast.error('The report could not be generated.');
      }
    });
  }

  const selectedLabel = REPORT_TYPES.find((type) => type.value === reportType)?.label ?? '';

  return (
    <Card>
      <CardHeader title="Generate Report" description="Create a management-ready report with real-time portfolio data." />
      <CardBody className="pt-0">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <div className="flex flex-col gap-3">
            <Field label="Report Type">
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Time Period">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Scope">
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Entire Portfolio</SelectItem>
                  {allProperties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Executive Commentary" hint="Optional narrative added to the report.">
              <textarea
                value={commentary}
                onChange={(event) => setCommentary(event.target.value)}
                rows={3}
                placeholder="Add management commentary..."
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 py-2 text-[13px] leading-5 focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
              />
            </Field>

            <Button onClick={() => void generate()} loading={pending} className="w-full">
              Generate Report
              <ArrowRight className="rtl-flip" />
            </Button>
          </div>

          {/* Preview */}
          <div className="lg:col-span-2">
            <div className="flex h-full flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-8 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--color-espresso-800)]">
                <FileText className="size-6 text-[var(--color-gold-300)]" aria-hidden />
              </div>
              <p className="font-[var(--font-serif)] text-[18px] font-bold tracking-wide text-[var(--color-espresso-800)]">
                RIFTARA
              </p>
              <p className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">{selectedLabel}</p>
              <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                {PERIODS.find((p) => p.value === period)?.label} ·{' '}
                {propertyId === '__all__' ? 'Entire Portfolio' : allProperties.find((p) => p.id === propertyId)?.name}
              </p>
              <p className="mt-4 max-w-sm text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
                The report includes KPIs, financial performance, occupancy, collections and aging, maintenance,
                property ranking, tenant concentration, key risks and management actions — rendered as a branded PDF.
              </p>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

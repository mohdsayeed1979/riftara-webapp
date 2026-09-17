'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';

type ImportMode = 'create_only' | 'update_existing' | 'create_and_update';
type RowAction = 'create' | 'update' | 'skip' | 'error';

interface RowIssue { field?: string; code: string; message: string; value?: string }
interface RowResult {
  rowNumber: number;
  code: string;
  nameEn?: string | null;
  unitNumber?: string | null;
  propertyCode?: string;
  action: RowAction;
  errors: RowIssue[];
  warnings: RowIssue[];
}
interface SectionSummary { total: number; create: number; update: number; skip: number; error: number; warning: number }
interface Preview {
  properties: { summary: SectionSummary; results: RowResult[] };
  units: { summary: SectionSummary; results: RowResult[] };
  canImport: boolean;
}
interface ExecuteResult {
  batchId: string;
  properties: { imported: number; updated: number; skipped: number; errors: number };
  units: { imported: number; updated: number; skipped: number; errors: number };
}

const MODE_OPTIONS = [
  { id: 'create_only', name: 'Create Only' },
  { id: 'update_existing', name: 'Update Existing' },
  { id: 'create_and_update', name: 'Create + Update' },
];

const ACTION_TONE: Record<RowAction, string> = { create: 'available', update: 'in_progress', skip: 'due', error: 'overdue' };

function SummaryCards({ summary }: { summary: SectionSummary }) {
  const cells: Array<[string, number]> = [
    ['Total', summary.total], ['Create', summary.create], ['Update', summary.update],
    ['Duplicate/Skip', summary.skip], ['Warnings', summary.warning], ['Errors', summary.error],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-2 text-center">
          <p className="text-[16px] font-semibold tabular">{value}</p>
          <p className="text-[10.5px] text-[var(--color-text-tertiary)]">{label}</p>
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ results }: { results: RowResult[] }) {
  const shown = results.slice(0, 100);
  return (
    <TableContainer className="max-h-72 overflow-y-auto">
      <Table>
        <THead>
          <TR><TH>Row</TH><TH>Code</TH><TH>Name / Unit</TH><TH>Action</TH><TH>Validation</TH></TR>
        </THead>
        <TBody>
          {shown.map((r) => (
            <TR key={r.rowNumber}>
              <TD className="text-[var(--color-text-tertiary)]">{r.rowNumber}</TD>
              <TD className="font-medium">{r.code || r.propertyCode || '—'}</TD>
              <TD>{r.nameEn ?? r.unitNumber ?? '—'}</TD>
              <TD><StatusBadge status={ACTION_TONE[r.action]} label={r.action.toUpperCase()} dot={false} size="sm" /></TD>
              <TD className="text-[11.5px]">
                {r.errors.map((e, i) => <p key={i} className="text-[var(--color-error)]">{e.field ? `${e.field}: ` : ''}{e.message}</p>)}
                {r.warnings.map((w, i) => <p key={i} className="text-[var(--color-warning)]">{w.message}</p>)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {results.length > shown.length ? <p className="p-2 text-center text-[11px] text-[var(--color-text-tertiary)]">+{results.length - shown.length} more rows not shown</p> : null}
    </TableContainer>
  );
}

export function ImportWizard({ kind }: { kind: 'properties' | 'units' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('create_only');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setSkipErrors(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function validate() {
    if (!file) return;
    setPending(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('mode', mode);
      const res = await fetch(`/api/v1/import/${kind}/validate`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Validation failed.');
        return;
      }
      setPreview(json.data as Preview);
    } catch {
      toast.error('Could not validate the file.');
    } finally {
      setPending(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setPending(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('mode', mode);
      fd.set('skipErrorRows', String(skipErrors));
      const res = await fetch(`/api/v1/import/${kind}/execute`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Import failed.', {
          description: json.error?.details?.batchId ? 'Download the error report for details.' : undefined,
        });
        if (json.error?.details?.batchId) setResult({ batchId: json.error.details.batchId, properties: { imported: 0, updated: 0, skipped: 0, errors: preview?.properties.summary.error ?? 0 }, units: { imported: 0, updated: 0, skipped: 0, errors: preview?.units.summary.error ?? 0 } });
        return;
      }
      setResult(json.data as ExecuteResult);
      toast.success('Import completed.');
      router.refresh();
    } catch {
      toast.error('Could not run the import.');
    } finally {
      setPending(false);
    }
  }

  const hasErrors = (preview?.properties.summary.error ?? 0) + (preview?.units.summary.error ?? 0) > 0;
  const canRunImport = preview ? (preview.canImport || (hasErrors && skipErrors)) : false;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="secondary"><Upload />Import</Button>
      </DialogTrigger>
      <DialogContent size="xl">
        <DialogHeader title={`Bulk Import — ${kind === 'properties' ? 'Properties' : 'Units'}`} description="Upload an Excel (.xlsx) or CSV file. Everything is validated before anything is written." />
        <DialogBody className="flex flex-col gap-4">
          {!result ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Import Mode" className="w-56">
                  <NativeSelect value={mode} onChange={(v) => setMode(v as ImportMode)} options={MODE_OPTIONS} />
                </Field>
                <Button type="button" variant="secondary" asChild>
                  <a href={`/api/v1/import/templates/${kind}`}><Download />Download {kind === 'properties' ? 'Property' : 'Unit'} Template</a>
                </Button>
                {kind === 'properties' ? (
                  <Button type="button" variant="secondary" asChild>
                    <a href="/api/v1/import/templates/properties?combined=true"><Download />Download Combined Template</a>
                  </Button>
                ) : null}
              </div>

              <Field label="File (.xlsx or .csv)">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 py-2 text-[13.5px]"
                />
              </Field>

              {!preview ? (
                <Button type="button" loading={pending} disabled={!file} onClick={validate}>
                  <FileSpreadsheet />Validate File
                </Button>
              ) : (
                <div className="flex flex-col gap-4">
                  {preview.properties.summary.total > 0 ? (
                    <div>
                      <p className="mb-1 text-[12.5px] font-semibold">Properties</p>
                      <SummaryCards summary={preview.properties.summary} />
                      <div className="mt-2"><ResultsTable results={preview.properties.results} /></div>
                    </div>
                  ) : null}
                  {preview.units.summary.total > 0 ? (
                    <div>
                      <p className="mb-1 text-[12.5px] font-semibold">Units</p>
                      <SummaryCards summary={preview.units.summary} />
                      <div className="mt-2"><ResultsTable results={preview.units.results} /></div>
                    </div>
                  ) : null}
                  {hasErrors ? (
                    <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
                      <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                      Import valid rows only (skip rows with errors)
                    </label>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-4">
              {result.properties.imported + result.properties.updated + result.properties.skipped + result.properties.errors > 0 ? (
                <div>
                  <p className="mb-1 text-[12.5px] font-semibold">Properties</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-[16px] font-semibold">{result.properties.imported}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Imported</p></div>
                    <div><p className="text-[16px] font-semibold">{result.properties.updated}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Updated</p></div>
                    <div><p className="text-[16px] font-semibold">{result.properties.skipped}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Skipped</p></div>
                    <div><p className="text-[16px] font-semibold">{result.properties.errors}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Errors</p></div>
                  </div>
                </div>
              ) : null}
              {result.units.imported + result.units.updated + result.units.skipped + result.units.errors > 0 ? (
                <div>
                  <p className="mb-1 text-[12.5px] font-semibold">Units</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-[16px] font-semibold">{result.units.imported}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Imported</p></div>
                    <div><p className="text-[16px] font-semibold">{result.units.updated}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Updated</p></div>
                    <div><p className="text-[16px] font-semibold">{result.units.skipped}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Skipped</p></div>
                    <div><p className="text-[16px] font-semibold">{result.units.errors}</p><p className="text-[10.5px] text-[var(--color-text-tertiary)]">Errors</p></div>
                  </div>
                </div>
              ) : null}
              <Button type="button" variant="secondary" asChild>
                <a href={`/api/v1/import/history/${result.batchId}/errors`}><Download />Download Error Report</a>
              </Button>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Close</Button></DialogClose>
          {!result && preview ? (
            <Button type="button" loading={pending} disabled={!canRunImport} onClick={runImport}>
              Import Valid Rows
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

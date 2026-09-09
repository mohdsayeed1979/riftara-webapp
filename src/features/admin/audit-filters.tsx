'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const ACTIONS = ['create', 'update', 'delete', 'soft_delete', 'restore', 'approve', 'reject', 'publish', 'unpublish', 'login', 'login_failed', 'logout', 'export', 'import', 'sign', 'allocate', 'sync'];

/** Audit-log filter bar: entity type, action, and a created-date range. */
export function AuditFilters({ entityTypes }: { entityTypes: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [entityType, setEntityType] = useState(params.get('entityType') ?? '');
  const [action, setAction] = useState(params.get('action') ?? '');
  const [dateFrom, setDateFrom] = useState(params.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(params.get('dateTo') ?? '');

  function apply() {
    const q = new URLSearchParams();
    if (entityType) q.set('entityType', entityType);
    if (action) q.set('action', action);
    if (dateFrom) q.set('dateFrom', dateFrom);
    if (dateTo) q.set('dateTo', dateTo);
    router.push(`/audit?${q.toString()}`);
  }
  function reset() { setEntityType(''); setAction(''); setDateFrom(''); setDateTo(''); router.push('/audit'); }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Entity">
        <NativeSelect value={entityType} onChange={setEntityType} placeholder="All entities" options={entityTypes.map((e) => ({ id: e, name: e.replace(/_/g, ' ') }))} />
      </Field>
      <Field label="Action">
        <NativeSelect value={action} onChange={setAction} placeholder="All actions" options={ACTIONS.map((a) => ({ id: a, name: a.replace(/_/g, ' ') }))} />
      </Field>
      <Field label="From"><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
      <Field label="To"><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
      <div className="flex items-end gap-2">
        <Button onClick={apply}>Apply</Button>
        <Button variant="ghost" onClick={reset}>Reset</Button>
      </div>
    </div>
  );
}

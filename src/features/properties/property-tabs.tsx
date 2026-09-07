import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  contracts,
  documents,
  operatingExpenses,
  expenseCategories,
  tenants,
  units,
  unitStatuses,
  valuations,
  auditLogs,
} from '@/db/schema';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { getPropertyOwnership } from '@/services/property-service';
import { listBuildingsWithFloors, nextBuildingCode } from '@/services/building-service';
import { BuildingsPanel } from '@/features/properties/buildings-panel';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/i18n/config';
import { formatArea, formatCompactCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'buildings', label: 'Buildings' },
  { key: 'units', label: 'Units' },
  { key: 'leasing', label: 'Leasing' },
  { key: 'financials', label: 'Financial' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'documents', label: 'Documents' },
  { key: 'audit', label: 'Audit' },
];

/**
 * Server-rendered tab set for the property detail page. Each tab navigates via
 * `?tab=` so the panel data is fetched on demand, keeping the initial render
 * light while every tab stays deep-linkable.
 */
export interface PropertyManagement {
  organizationId: string;
  canCreateBuilding: boolean;
  canEditBuilding: boolean;
  canDeleteBuilding: boolean;
  canCreateUnit: boolean;
}

export async function PropertyTabs({
  propertyId,
  activeTab,
  locale,
  overview,
  management,
}: {
  propertyId: string;
  activeTab: string;
  locale: Locale;
  overview: ReactNode;
  management: PropertyManagement;
}) {
  return (
    <div>
      <nav
        className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border-base)]"
        aria-label="Property sections"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={
                tab.key === 'overview'
                  ? `/properties/${propertyId}`
                  : `/properties/${propertyId}?tab=${tab.key}`
              }
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'border-[var(--color-primary)] text-[var(--color-text-primary)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === 'overview' ? overview : <PropertyTabPanel propertyId={propertyId} tab={activeTab} locale={locale} management={management} />}
    </div>
  );
}

async function PropertyTabPanel({
  propertyId,
  tab,
  locale,
  management,
}: {
  propertyId: string;
  tab: string;
  locale: Locale;
  management: PropertyManagement;
}) {
  const money = (value: number) => formatCompactCurrency(value, { locale });

  switch (tab) {
    case 'buildings': {
      const [rows, suggestedCode] = await Promise.all([
        listBuildingsWithFloors(management.organizationId, propertyId),
        nextBuildingCode(management.organizationId, propertyId),
      ]);
      return (
        <BuildingsPanel
          propertyId={propertyId}
          suggestedCode={suggestedCode}
          buildings={rows.map((b) => ({
            ...b,
            grossLeasableArea: b.grossLeasableArea != null ? Number(b.grossLeasableArea) : null,
            floors: b.floors.map((f) => ({ ...f, grossArea: f.grossArea != null ? Number(f.grossArea) : null })),
          }))}
          permissions={{
            canCreate: management.canCreateBuilding,
            canEdit: management.canEditBuilding,
            canDelete: management.canDeleteBuilding,
          }}
        />
      );
    }

    case 'units': {
      const db = await getDb();
      const rows = await db
        .select({
          id: units.id,
          unitNumber: units.unitNumber,
          statusKey: unitStatuses.key,
          statusLabel: unitStatuses.nameEn,
          availabilityClass: units.computedAvailabilityClass,
          leasableArea: units.leasableArea,
        })
        .from(units)
        .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
        .where(and(eq(units.propertyId, propertyId), isNull(units.deletedAt)))
        .orderBy(units.code)
        .limit(200);
      if (rows.length === 0)
        return (
          <Card>
            <EmptyState
              title="No units"
              description="Add a unit to this property to start building inventory."
              action={
                management.canCreateUnit ? (
                  <Button asChild>
                    <Link href={`/units/new?propertyId=${propertyId}`}>
                      <Plus />
                      Add Unit
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        );
      return (
        <Card>
          <CardHeader
            title="Units"
            action={
              <div className="flex items-center gap-3">
                {management.canCreateUnit ? (
                  <Button size="sm" asChild>
                    <Link href={`/units/new?propertyId=${propertyId}`}>
                      <Plus />
                      Add Unit
                    </Link>
                  </Button>
                ) : null}
                <Link href={`/units?propertyId=${propertyId}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                  Open in inventory
                </Link>
              </div>
            }
          />
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Unit</TH>
                  <TH alignment="end">Area</TH>
                  <TH alignment="center">Availability</TH>
                  <TH alignment="center">Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((unit) => (
                  <TR key={unit.id} interactive>
                    <TD>
                      <Link href={`/units/${unit.id}`} className="font-medium hover:text-[var(--color-info)]">
                        {unit.unitNumber}
                      </Link>
                    </TD>
                    <TD alignment="end" numeric>{formatArea(Number(unit.leasableArea ?? 0), { locale })}</TD>
                    <TD alignment="center"><StatusBadge status={unit.availabilityClass} /></TD>
                    <TD alignment="center"><StatusBadge status={unit.statusKey} label={unit.statusLabel} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'leasing': {
      const db = await getDb();
      const rows = await db
        .select({
          id: contracts.id,
          contractNumber: contracts.contractNumber,
          tenantName: tenants.displayName,
          unitNumber: units.unitNumber,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          annualRent: contracts.annualRent,
          status: contracts.status,
        })
        .from(contracts)
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .innerJoin(units, eq(units.id, contracts.unitId))
        .where(and(eq(contracts.propertyId, propertyId), isNull(contracts.deletedAt)))
        .orderBy(desc(contracts.startDate))
        .limit(100);
      if (rows.length === 0) return <EmptyCard title="No contracts" />;
      return (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Tenant</TH>
                  <TH>Unit</TH>
                  <TH alignment="end">Annual Rent</TH>
                  <TH alignment="end">Start</TH>
                  <TH alignment="end">End</TH>
                  <TH alignment="center">Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} interactive>
                    <TD>
                      <Link href={`/contracts/${row.id}`} className="font-medium hover:text-[var(--color-info)]">
                        {row.contractNumber}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.tenantName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.unitNumber}</TD>
                    <TD alignment="end" numeric>{money(Number(row.annualRent))}</TD>
                    <TD alignment="end">{formatDate(row.startDate, { locale, style: 'short' })}</TD>
                    <TD alignment="end">{formatDate(row.endDate, { locale, style: 'short' })}</TD>
                    <TD alignment="center"><StatusBadge status={row.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'valuation': {
      const db = await getDb();
      const rows = await db
        .select()
        .from(valuations)
        .where(eq(valuations.propertyId, propertyId))
        .orderBy(desc(valuations.valuationDate))
        .limit(20);
      if (rows.length === 0) return <EmptyCard title="No valuations" />;
      return (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Valuation Date</TH>
                  <TH>Company</TH>
                  <TH>Method</TH>
                  <TH alignment="end">Market Value</TH>
                  <TH alignment="end">Book Value</TH>
                  <TH alignment="end">Change</TH>
                  <TH alignment="center">Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-medium">{formatDate(row.valuationDate, { locale })}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.valuationCompany ?? '—'}</TD>
                    <TD className="text-[var(--color-text-secondary)] capitalize">{row.valuationMethod ?? '—'}</TD>
                    <TD alignment="end" numeric>{money(Number(row.marketValue))}</TD>
                    <TD alignment="end" numeric>{row.bookValue ? money(Number(row.bookValue)) : '—'}</TD>
                    <TD alignment="end" numeric className={Number(row.changePercent ?? 0) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                      {row.changePercent !== null ? `${Number(row.changePercent) >= 0 ? '+' : ''}${Number(row.changePercent).toFixed(1)}%` : '—'}
                    </TD>
                    <TD alignment="center">
                      {row.isCurrent ? <StatusBadge status="active" label="Current" /> : <StatusBadge status="superseded" />}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'expenses': {
      const db = await getDb();
      const now = new Date();
      const yearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const rows = await db
        .select({
          category: expenseCategories.nameEn,
          total: sql<number>`sum(${operatingExpenses.amount})::float8`,
          count: sql<number>`count(*)::int`,
        })
        .from(operatingExpenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
        .where(and(eq(operatingExpenses.propertyId, propertyId), gte(operatingExpenses.incurredOn, yearStart)))
        .groupBy(expenseCategories.nameEn)
        .orderBy(desc(sql`sum(${operatingExpenses.amount})`));
      if (rows.length === 0) return <EmptyCard title="No operating expenses recorded" />;
      const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
      return (
        <Card>
          <CardHeader title="Operating Expenses" description="Trailing 12 months by category" />
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>Category</TH><TH alignment="end">Entries</TH><TH alignment="end">Amount</TH><TH alignment="end">Share</TH></TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.category}>
                    <TD className="font-medium">{row.category}</TD>
                    <TD alignment="end" numeric>{Number(row.count)}</TD>
                    <TD alignment="end" numeric>{money(Number(row.total))}</TD>
                    <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">
                      {((Number(row.total) / total) * 100).toFixed(1)}%
                    </TD>
                  </TR>
                ))}
                <TR className="bg-[var(--color-surface-muted)] font-semibold">
                  <TD>Total OPEX</TD><TD />
                  <TD alignment="end" numeric>{money(total)}</TD><TD />
                </TR>
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'financials': {
      return (
        <Card>
          <EmptyState
            title="Financial performance"
            description="Detailed financial breakdowns are available on the property dashboard and collections module."
            action={
              <Link href={`/collections?propertyId=${propertyId}`} className="text-[13px] font-medium text-[var(--color-info)] hover:underline">
                Open collections for this property
              </Link>
            }
          />
        </Card>
      );
    }

    case 'ownership': {
      const rows = await getPropertyOwnership(propertyId);
      if (rows.length === 0) return <EmptyCard title="No ownership records" />;
      return (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Owner</TH>
                  <TH>Document Type</TH>
                  <TH>Document Number</TH>
                  <TH>Issuing Authority</TH>
                  <TH alignment="end">Ownership %</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-medium">{row.ownerName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.documentType}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.documentNumber}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.issuingAuthority ?? '—'}</TD>
                    <TD alignment="end" numeric>{Number(row.ownershipPercentage)}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'documents': {
      const db = await getDb();
      const rows = await db
        .select()
        .from(documents)
        .where(and(eq(documents.entityType, 'property'), eq(documents.entityId, propertyId), isNull(documents.deletedAt)))
        .orderBy(desc(documents.createdAt))
        .limit(50);
      if (rows.length === 0) return <EmptyCard title="No documents" description="Ownership documents, licenses and reports will appear here." />;
      return (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>Document</TH><TH>Category</TH><TH alignment="end">Uploaded</TH><TH alignment="end">Expiry</TH></TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-medium">{row.title}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.entityType}</TD>
                    <TD alignment="end">{formatDate(row.createdAt, { locale, style: 'short' })}</TD>
                    <TD alignment="end">{row.expiryDate ? formatDate(row.expiryDate, { locale, style: 'short' }) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    case 'audit': {
      const db = await getDb();
      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'property'), eq(auditLogs.entityId, propertyId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);
      if (rows.length === 0) return <EmptyCard title="No audit entries" description="Changes to this property will be recorded here." />;
      return (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Changed Fields</TH></TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDateTime(row.createdAt, { locale })}</TD>
                    <TD>{row.actorLabel ?? 'System'}</TD>
                    <TD><StatusBadge status={row.action} dot={false} /></TD>
                    <TD className="text-[var(--color-text-secondary)]">{(row.changedFields ?? []).join(', ') || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      );
    }

    default:
      return <EmptyCard title="Section unavailable" />;
  }
}

function EmptyCard({ title, description }: { title: string; description?: string }) {
  return (
    <Card>
      <EmptyState title={title} description={description} />
    </Card>
  );
}

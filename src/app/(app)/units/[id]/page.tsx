import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, Layers, Pencil, Ruler } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { UnitPublishControl } from '@/features/units/unit-publish-control';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatArea, formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { EntityDocuments } from '@/features/documents/entity-documents';
import { isUuid } from '@/lib/utils';
import { getUnitDetail, getUnitLeaseHistory, getUnitPriceHistory } from '@/services/unit-service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await requirePermission('units:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const unit = await getUnitDetail(user.organizationId, id);
  return { title: unit ? `Unit ${unit.unitNumber}` : 'Unit' };
}

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('units:view');
  const { id } = await params;
  // A non-UUID segment must never reach a uuid column query (PostgreSQL 22P02).
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const unit = await getUnitDetail(user.organizationId, id);
  if (!unit) notFound();

  const [priceHistory, leaseHistory] = await Promise.all([
    getUnitPriceHistory(id),
    getUnitLeaseHistory(id),
  ]);

  const currency = (value: number) => formatCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Properties', href: '/properties' },
          { label: unit.propertyName, href: `/properties/${unit.propertyId}` },
          { label: `Unit ${unit.unitNumber}` },
        ]}
        title={`Unit ${unit.unitNumber}`}
        badge={<StatusBadge status={unit.statusKey} label={unit.statusLabel} size="md" />}
        meta={
          <>
            <MetaItem icon={<Building2 />}>{unit.propertyName}</MetaItem>
            {unit.floorName ? <MetaItem icon={<Layers />}>{unit.floorName}</MetaItem> : null}
            <MetaItem icon={<Building2 />}>{unit.typeName}</MetaItem>
            <MetaItem icon={<Ruler />}>{formatArea(unit.leasableArea, { locale })}</MetaItem>
          </>
        }
        actions={
          <>
            {can(user, 'units:edit') ? (
              <Button variant="secondary" asChild>
                <Link href={`/units/${id}/edit`}>
                  <Pencil />
                  Edit Unit
                </Link>
              </Button>
            ) : null}
            {can(user, 'contracts:create') ? (
              <Button variant="secondary" asChild>
                <Link href={`/contracts/new?unitId=${id}`}>Create Contract</Link>
              </Button>
            ) : null}
            <Button variant="ghost" asChild>
              <Link href={`/properties/${unit.propertyId}`}>View Property</Link>
            </Button>
            {unit.buildingName ? (
              <Button variant="ghost" asChild>
                <Link href={`/properties/${unit.propertyId}?tab=buildings`}>View Building</Link>
              </Button>
            ) : null}
            {can(user, 'units:publish') ? (
              <UnitPublishControl
                unitId={id}
                publicationState={unit.publicationState}
                availabilityClass={unit.availabilityClass}
              />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Unit Information" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Unit Number" value={unit.unitNumber} />
                <DetailRow label="Unit Code" value={unit.code} />
                <DetailRow label="Property" value={unit.propertyName} href={`/properties/${unit.propertyId}`} />
                <DetailRow label="Floor" value={unit.floorName ?? '—'} />
                <DetailRow label="Type" value={unit.typeName} />
                <DetailRow label="Usage" value={<span className="capitalize">{unit.usageType}</span>} />
                <DetailRow label="Condition" value={<span className="capitalize">{unit.condition ?? '—'}</span>} />
                <DetailRow label="Fit-out Status" value={<span className="capitalize">{unit.fitOutStatus.replace(/_/g, ' ')}</span>} />
              </DetailList>
              <DetailList>
                <DetailRow label="Gross Area" value={unit.grossArea ? formatArea(unit.grossArea, { locale }) : '—'} />
                <DetailRow label="Net Area" value={unit.netArea ? formatArea(unit.netArea, { locale }) : '—'} />
                <DetailRow label="Leasable Area" value={formatArea(unit.leasableArea, { locale })} />
                <DetailRow label="Parking" value={unit.parkingAllocation} />
                {unit.bedroomCount !== null ? <DetailRow label="Bedrooms" value={unit.bedroomCount} /> : null}
                {unit.bathroomCount !== null ? <DetailRow label="Bathrooms" value={unit.bathroomCount} /> : null}
                <DetailRow label="Furnishing" value={<span className="capitalize">{unit.furnishingStatus.replace(/_/g, ' ')}</span>} />
                <DetailRow label="HVAC" value={unit.hvacType ?? '—'} />
              </DetailList>
            </div>
            {unit.usageType !== 'residential' ? (
              <>
                <div className="my-4 h-px bg-[var(--color-border-subtle)]" />
                <p className="mb-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">Commercial specifications</p>
                <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  <DetailList>
                    <DetailRow label="Frontage" value={unit.frontage ? `${unit.frontage} m` : '—'} />
                    <DetailRow label="Ceiling Height" value={unit.ceilingHeight ? `${unit.ceilingHeight} m` : '—'} />
                    <DetailRow label="Electrical Load" value={unit.electricalLoad ?? '—'} />
                  </DetailList>
                  <div className="flex flex-wrap items-start gap-1.5 py-2.5">
                    {unit.signageRights ? <Badge tone="success" dot>Signage Rights</Badge> : null}
                    {unit.loadingAccess ? <Badge tone="success" dot>Loading Access</Badge> : null}
                    {unit.permittedActivities.map((activity) => (
                      <Badge key={activity} tone="outline">{activity}</Badge>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Pricing"
              action={
                can(user, 'units:edit') ? (
                  <Link href={`/units/${id}/edit`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                    Edit
                  </Link>
                ) : null
              }
            />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Asking Rent" value={<span className="text-[15px] font-semibold">{currency(unit.askingRent)}</span>} />
                <DetailRow label="Rent / m²" value={currency(unit.rentPerSqm)} />
                {unit.targetRent !== null ? <DetailRow label="Target Rent" value={currency(unit.targetRent)} /> : null}
                {unit.minimumRent !== null ? <DetailRow label="Minimum Rent" value={currency(unit.minimumRent)} /> : null}
                {unit.marketRent !== null ? <DetailRow label="Market Rent" value={currency(unit.marketRent)} /> : null}
                <DetailRow label="Service Charges" value={currency(unit.serviceCharges)} />
                <DetailRow label="Deposit" value={currency(unit.depositAmount)} />
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Availability" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Status" value={<StatusBadge status={unit.statusKey} label={unit.statusLabel} />} />
                <DetailRow label="Availability" value={<StatusBadge status={unit.availabilityClass} />} />
                <DetailRow
                  label="Available From"
                  value={unit.availabilityClass === 'available' ? 'Now' : unit.availableFrom ? formatDate(unit.availableFrom, { locale }) : '—'}
                />
                {unit.tenantName ? <DetailRow label="Current Tenant" value={unit.tenantName} /> : null}
                <DetailRow label="Published" value={unit.publicationState === 'unpublished' ? 'No' : 'Yes'} />
              </DetailList>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Lease History" />
          {leaseHistory.length === 0 ? (
            <EmptyState title="No lease history" description="Contracts for this unit will appear here." />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Tenant</TH><TH alignment="end">Start</TH><TH alignment="end">End</TH><TH alignment="end">Annual Rent</TH><TH alignment="center">Status</TH></TR>
                </THead>
                <TBody>
                  {leaseHistory.map((lease) => (
                    <TR key={lease.id} interactive>
                      <TD>
                        <Link href={`/contracts/${lease.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {lease.tenantName}
                        </Link>
                      </TD>
                      <TD alignment="end">{formatDate(lease.startDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end">{formatDate(lease.endDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric>{currency(Number(lease.annualRent))}</TD>
                      <TD alignment="center"><StatusBadge status={lease.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <Card>
          <CardHeader title="Price History" description="Every pricing change is retained (BR-005)." />
          {priceHistory.length === 0 ? (
            <EmptyState title="No price history" description="Pricing changes will be recorded here." />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Field</TH><TH alignment="end">Previous</TH><TH alignment="end">New</TH><TH alignment="end">Effective</TH><TH>Reason</TH></TR>
                </THead>
                <TBody>
                  {priceHistory.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="font-medium capitalize">{entry.field.replace(/([A-Z])/g, ' $1').trim()}</TD>
                      <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">
                        {entry.previousValue !== null ? currency(Number(entry.previousValue)) : '—'}
                      </TD>
                      <TD alignment="end" numeric>{currency(Number(entry.newValue))}</TD>
                      <TD alignment="end">{formatDate(entry.effectiveDate, { locale, style: 'short' })}</TD>
                      <TD className="max-w-48 truncate text-[var(--color-text-secondary)]">{entry.reason ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </div>
      <EntityDocuments user={user} entityType="unit" entityId={id} locale={locale} />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  Layers,
  MapPin,
  Pencil,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { PropertyImage } from '@/components/ui/property-image';
import { StatusBadge } from '@/components/ui/status-badge';
import { PropertyTabs } from '@/features/properties/property-tabs';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatArea, formatCompactCurrency, formatDate, formatPercent } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getPropertyDetail } from '@/services/property-service';
import { getPropertyPerformance, scopeFromSession } from '@/services/metrics-service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await requirePermission('properties:view');
  const { id } = await params;
  // A non-UUID segment (e.g. "new") must never reach a uuid column query.
  if (!isUuid(id)) notFound();
  const property = await getPropertyDetail(user.organizationId, id);
  return { title: property?.nameEn ?? 'Property' };
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission('properties:view');
  const { id } = await params;
  // Guard the dynamic segment: a non-UUID id (e.g. "new") would otherwise
  // trigger a PostgreSQL 22P02 uuid cast error instead of a clean 404.
  if (!isUuid(id)) notFound();
  const { tab } = await searchParams;
  const locale = await getRequestLocale();

  const property = await getPropertyDetail(user.organizationId, id);
  if (!property) notFound();

  const scope = scopeFromSession(user, { propertyId: id });
  const performance = (await getPropertyPerformance(scope))[0];
  const money = (value: number) => formatCompactCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Properties', href: '/properties' },
          { label: property.nameEn },
        ]}
        title={property.nameEn}
        badge={<StatusBadge status={property.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<MapPin />}>
              {property.cityName}
              {property.districtName ? `, ${property.districtName}` : ''}
            </MetaItem>
            <MetaItem icon={<Building2 />}>{property.typeName}</MetaItem>
            {property.constructionYear ? (
              <MetaItem icon={<CalendarDays />}>Built {property.constructionYear}</MetaItem>
            ) : null}
            <MetaItem icon={<Layers />}>{property.unitCount} units</MetaItem>
            <span className="text-[var(--color-text-tertiary)]">{property.code}</span>
          </>
        }
        actions={
          <>
            {property.googleMapsReference ? (
              <Button variant="secondary" asChild>
                <a href={property.googleMapsReference} target="_blank" rel="noopener noreferrer">
                  <MapPin />
                  View on Map
                </a>
              </Button>
            ) : null}
            {can(user, 'properties:edit') ? (
              <Button variant="secondary" asChild>
                <Link href={`/properties/${id}/edit`}>
                  <Pencil />
                  Edit Property
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Cover + KPI summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="overflow-hidden">
          <PropertyImage src={property.coverImageUrl} alt={property.nameEn} className="h-44 w-full" />
          <CardBody className="pt-3">
            <p className="text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {property.descriptionEn}
            </p>
            {property.amenities.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {property.amenities.map((amenity) => (
                  <Badge key={amenity} tone="outline">
                    {amenity}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard
            label="Occupancy Rate"
            value={formatPercent(performance?.occupancyRate ?? 0, { locale })}
            caption={`${performance?.occupiedUnits ?? 0} of ${performance?.totalUnits ?? 0} units`}
            tone="success"
            ringValue={performance?.occupancyRate ?? 0}
          />
          <KpiCard
            label="Annual Rental Value"
            value={money(performance?.annualRentalValue ?? 0)}
            caption="At full occupancy"
            icon={<CircleDollarSign />}
            tone="gold"
          />
          <KpiCard
            label="Collected Revenue"
            value={money(performance?.collected ?? 0)}
            caption={`${formatPercent(performance?.collectionRate ?? 0, { locale })} of billed`}
            tone="info"
            href={`/collections?propertyId=${id}`}
          />
          <KpiCard
            label="Vacant Units"
            value={String(performance?.availableUnits ?? 0)}
            caption={`${formatPercent(100 - (performance?.occupancyRate ?? 0), { locale })} vacancy`}
            icon={<Building2 />}
            tone="warning"
            higherIsBetter={false}
            href={`/units?propertyId=${id}&availability=available`}
          />
          <KpiCard
            label="Maintenance Cost"
            value={money(performance?.maintenanceCost ?? 0)}
            caption="Trailing 12 months"
            icon={<Wrench />}
            tone="neutral"
            higherIsBetter={false}
            href={`/maintenance?propertyId=${id}`}
          />
          <KpiCard
            label="Net Operating Income"
            value={money(performance?.netOperatingIncome ?? 0)}
            caption={`${formatPercent(performance?.noiMargin ?? 0, { locale })} margin`}
            icon={<TrendingUp />}
            tone="info"
          />
        </div>
      </div>

      <PropertyTabs
        propertyId={id}
        activeTab={tab ?? 'overview'}
        locale={locale}
        overview={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Property Information" />
              <CardBody className="pt-0">
                <DetailList>
                  <DetailRow label="Property Code" value={property.code} />
                  <DetailRow label="English Name" value={property.nameEn} />
                  {property.nameAr ? <DetailRow label="Arabic Name" value={property.nameAr} /> : null}
                  <DetailRow label="Type" value={property.typeName} />
                  <DetailRow label="Usage" value={<span className="capitalize">{property.usage}</span>} />
                  <DetailRow label="Region" value={property.regionName ?? '—'} />
                  <DetailRow label="City" value={property.cityName} />
                  <DetailRow label="District" value={property.districtName ?? '—'} />
                  <DetailRow label="Address" value={property.addressLine ?? '—'} />
                  <DetailRow label="National Address" value={property.nationalAddress ?? '—'} />
                  <DetailRow label="Cost Center" value={property.costCenter ?? '—'} />
                </DetailList>
              </CardBody>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader title="Management & Dates" />
                <CardBody className="pt-0">
                  <DetailList>
                    <DetailRow label="Property Manager" value={property.propertyManagerName ?? '—'} />
                    <DetailRow label="Leasing Manager" value={property.leasingManagerName ?? '—'} />
                    <DetailRow label="Asset Manager" value={property.assetManagerName ?? '—'} />
                    <DetailRow
                      label="Acquisition Date"
                      value={property.acquisitionDate ? formatDate(property.acquisitionDate, { locale }) : '—'}
                    />
                    <DetailRow
                      label="Operational Start"
                      value={
                        property.operationalStartDate
                          ? formatDate(property.operationalStartDate, { locale })
                          : '—'
                      }
                    />
                    <DetailRow label="Construction Year" value={property.constructionYear ?? '—'} />
                    <DetailRow label="Condition" value={<span className="capitalize">{property.condition ?? '—'}</span>} />
                  </DetailList>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Technical Information" />
                <CardBody className="pt-0">
                  <DetailList>
                    <DetailRow label="Land Area" value={property.landArea ? formatArea(property.landArea, { locale }) : '—'} />
                    <DetailRow label="Built-up Area" value={property.builtUpArea ? formatArea(property.builtUpArea, { locale }) : '—'} />
                    <DetailRow label="Gross Leasable Area" value={property.grossLeasableArea ? formatArea(property.grossLeasableArea, { locale }) : '—'} />
                    <DetailRow label="Common Area" value={property.commonArea ? formatArea(property.commonArea, { locale }) : '—'} />
                    <DetailRow label="Buildings" value={property.buildingCount} />
                    <DetailRow label="Floors" value={property.floorCount} />
                    <DetailRow label="Parking Capacity" value={property.parkingCapacity ?? '—'} />
                    <DetailRow label="Elevators" value={property.elevatorCount ?? '—'} />
                    <DetailRow label="HVAC" value={property.hvacType ?? '—'} />
                  </DetailList>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[
                      ['Fire Fighting', property.fireFightingSystem],
                      ['Fire Alarm', property.fireAlarmSystem],
                      ['Generator', property.generator],
                      ['BMS', property.buildingManagementSystem],
                      ['CCTV', property.cctv],
                      ['Access Control', property.accessControl],
                      ['Loading Facilities', property.loadingFacilities],
                      ['Emergency Systems', property.emergencySystems],
                    ]
                      .filter(([, enabled]) => enabled)
                      .map(([label]) => (
                        <Badge key={label as string} tone="success" dot>
                          {label as string}
                        </Badge>
                      ))}
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        }
      />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/utils';
import { and, desc, eq } from 'drizzle-orm';
import { CalendarClock, FileSignature, FileText, KeyRound, Pencil, Target, User } from 'lucide-react';
import { getDb } from '@/db/client';
import {
  customers,
  leadActivities,
  leads,
  leadSources,
  leadStages,
  properties,
  units,
  users,
} from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActivityTimeline } from '@/features/leasing/activity-timeline';
import { LogActivityForm } from '@/features/leasing/log-activity-form';
import { requirePermission, can } from '@/lib/auth/guard';
import { formatArea, formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('leasing:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const db = await getDb();

  const [lead] = await db
    .select({
      id: leads.id,
      code: leads.code,
      customerId: leads.customerId,
      customerName: customers.fullNameEn,
      companyName: customers.companyName,
      mobile: customers.mobile,
      email: customers.email,
      stageLabel: leadStages.nameEn,
      stageKey: leadStages.key,
      sourceName: leadSources.nameEn,
      propertyId: leads.requestedPropertyId,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      unitId: leads.requestedUnitId,
      requiredArea: leads.requiredArea,
      budgetMin: leads.budgetMin,
      budgetMax: leads.budgetMax,
      moveInDate: leads.moveInDate,
      qualification: leads.qualification,
      priority: leads.priority,
      score: leads.score,
      nextAction: leads.nextAction,
      nextFollowUpAt: leads.nextFollowUpAt,
      assignedName: users.fullName,
      firstResponseMinutes: leads.firstResponseMinutes,
      slaBreached: leads.slaBreached,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(leadStages, eq(leadStages.id, leads.stageId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(properties, eq(properties.id, leads.requestedPropertyId))
    .leftJoin(units, eq(units.id, leads.requestedUnitId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(and(eq(leads.id, id), eq(leads.organizationId, user.organizationId)))
    .limit(1);

  if (!lead) notFound();

  const activities = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.occurredAt))
    .limit(40);

  const money = (value: number | null) => (value !== null ? formatCompactCurrency(Number(value), { locale }) : '—');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Leasing CRM', href: '/leasing' },
          { label: lead.companyName ?? lead.customerName },
        ]}
        title={lead.companyName ?? lead.customerName}
        badge={<StatusBadge status={lead.stageKey} label={lead.stageLabel} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{lead.code}</MetaItem>
            {lead.sourceName ? <MetaItem icon={<Target />}>{lead.sourceName}</MetaItem> : null}
            {lead.assignedName ? <MetaItem icon={<User />}>{lead.assignedName}</MetaItem> : null}
            {lead.slaBreached ? <span className="text-[var(--color-error)]">SLA breached</span> : null}
          </>
        }
        actions={
          <>
            {can(user, 'leasing:edit') ? (
              <Button variant="secondary" asChild>
                <Link href={`/leasing/leads/${id}/edit`}>
                  <Pencil />
                  Edit Lead
                </Link>
              </Button>
            ) : null}
            {can(user, 'viewings:create') ? (
              <Button variant="secondary" asChild>
                <Link href={`/leasing/viewings/new?customerId=${lead.customerId}&leadId=${id}`}>
                  <KeyRound />
                  Create Viewing
                </Link>
              </Button>
            ) : null}
            {can(user, 'proposals:create') ? (
              <Button variant="secondary" asChild>
                <Link href={`/leasing/proposals/new?customerId=${lead.customerId}&leadId=${id}`}>
                  <FileText />
                  Create Proposal
                </Link>
              </Button>
            ) : null}
            {can(user, 'reservations:create') ? (
              <Button variant="secondary" asChild>
                <Link href={`/leasing/reservations/new?customerId=${lead.customerId}&leadId=${id}`}>
                  <FileSignature />
                  Create Reservation
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href={`/leasing/customers/${lead.customerId}`}>
                <User />
                Customer 360
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Requirement" />
            <CardBody className="pt-0">
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <DetailList>
                  <DetailRow
                    label="Requested Property"
                    value={lead.propertyName ?? '—'}
                    href={lead.propertyId ? `/properties/${lead.propertyId}` : undefined}
                  />
                  <DetailRow
                    label="Requested Unit"
                    value={lead.unitNumber ?? '—'}
                    href={lead.unitId ? `/units/${lead.unitId}` : undefined}
                  />
                  <DetailRow label="Required Area" value={lead.requiredArea ? formatArea(Number(lead.requiredArea), { locale }) : '—'} />
                </DetailList>
                <DetailList>
                  <DetailRow label="Budget" value={`${money(lead.budgetMin)} – ${money(lead.budgetMax)}`} />
                  <DetailRow label="Target Move-in" value={lead.moveInDate ? formatDate(lead.moveInDate, { locale }) : '—'} />
                  <DetailRow label="Qualification" value={<span className="capitalize">{lead.qualification}</span>} />
                </DetailList>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity Timeline" />
            <CardBody className="pt-0">
              {activities.length === 0 ? (
                <EmptyState title="No activity yet" description="Log the first interaction with this lead." />
              ) : (
                <ActivityTimeline
                  activities={activities.map((a) => ({
                    id: a.id,
                    activityType: a.activityType,
                    subject: a.subject,
                    body: a.body,
                    outcome: a.outcome,
                    occurredAt: a.occurredAt.toISOString(),
                  }))}
                  locale={locale}
                />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Next Action" />
            <CardBody className="pt-0">
              {lead.nextAction ? (
                <>
                  <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{lead.nextAction}</p>
                  {lead.nextFollowUpAt ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                      <CalendarClock className="size-3.5" aria-hidden />
                      {formatDate(lead.nextFollowUpAt, { locale })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[12.5px] text-[var(--color-text-secondary)]">No next action scheduled.</p>
              )}
            </CardBody>
          </Card>

          {can(user, 'leasing:edit') ? (
            <Card>
              <CardHeader title="Log Activity" />
              <CardBody className="pt-0">
                <LogActivityForm leadId={id} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Lead Details" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Priority" value={<StatusBadge status={lead.priority} dot={false} />} />
                <DetailRow label="Lead Score" value={<span className="tabular">{lead.score}</span>} />
                <DetailRow
                  label="First Response"
                  value={lead.firstResponseMinutes !== null ? `${lead.firstResponseMinutes} min` : 'Pending'}
                />
                <DetailRow label="Created" value={formatDate(lead.createdAt, { locale })} />
                <DetailRow label="Mobile" value={lead.mobile ?? '—'} />
                <DetailRow label="Email" value={lead.email ?? '—'} />
              </DetailList>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

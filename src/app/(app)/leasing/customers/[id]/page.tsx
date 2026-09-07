import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Mail,
  MessageCircle,
  Phone,
  Tag,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Avatar, EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActivityTimeline } from '@/features/leasing/activity-timeline';
import { requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getCustomer360 } from '@/services/customer-service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await requirePermission('customers:view');
  const { id } = await params;
  try {
    const { customer } = await getCustomer360(user.organizationId, id);
    return { title: customer.fullNameEn };
  } catch {
    return { title: 'Customer' };
  }
}

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('customers:view');
  const { id } = await params;
  const locale = await getRequestLocale();

  let data;
  try {
    data = await getCustomer360(user.organizationId, id);
  } catch {
    notFound();
  }

  const { customer, identifiers, leads, viewings, proposals, reservations, activities, tenantId } = data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Leasing CRM', href: '/leasing' },
          { label: 'Customer 360' },
        ]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={customer.fullNameEn} size="lg" />
            {customer.fullNameEn}
          </span>
        }
        badge={
          <div className="flex items-center gap-2">
            <Badge tone={customer.customerType === 'corporate' ? 'info' : 'neutral'}>
              {customer.customerType === 'corporate' ? 'Corporate' : 'Individual'}
            </Badge>
            {customer.priority === 'high' ? <Badge tone="error" dot>High priority</Badge> : null}
            {tenantId ? (
              <Link href={`/tenants/${tenantId}`}>
                <Badge tone="success">Active tenant</Badge>
              </Link>
            ) : null}
          </div>
        }
        actions={
          <>
            {customer.email ? (
              <Button variant="secondary" size="sm" asChild>
                <a href={`mailto:${customer.email}`}>
                  <Mail />
                  Email
                </a>
              </Button>
            ) : null}
            {customer.mobile ? (
              <>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`https://wa.me/${customer.mobile.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle />
                    WhatsApp
                  </a>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`tel:${customer.mobile}`}>
                    <Phone />
                    Call
                  </a>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr_320px]">
        {/* Profile */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={customer.customerType === 'corporate' ? 'Company Information' : 'Personal Information'} />
            <CardBody className="pt-0">
              <DetailList>
                {customer.companyName ? <DetailRow label="Company" value={customer.companyName} /> : null}
                <DetailRow label="Contact Person" value={customer.authorizedRepresentative ?? customer.fullNameEn} />
                <DetailRow label="Mobile" value={customer.mobile ?? '—'} />
                <DetailRow label="Email" value={customer.email ?? '—'} />
                {customer.nationality ? <DetailRow label="Nationality" value={customer.nationality} /> : null}
                {customer.businessActivity ? <DetailRow label="Business Activity" value={customer.businessActivity} /> : null}
                {customer.employer ? <DetailRow label="Employer" value={customer.employer} /> : null}
                <DetailRow label="Customer Code" value={customer.code} />
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Identification" />
            <CardBody className="pt-0">
              {identifiers.length === 0 ? (
                <p className="py-2 text-[12.5px] text-[var(--color-text-secondary)]">No identifiers recorded.</p>
              ) : (
                <DetailList>
                  {identifiers.map((identifier) => (
                    <DetailRow
                      key={identifier.id}
                      label={identifier.identifierType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      value={identifier.identifierValue}
                    />
                  ))}
                </DetailList>
              )}
            </CardBody>
          </Card>

          {customer.tags && customer.tags.length > 0 ? (
            <Card>
              <CardHeader title="Tags" />
              <CardBody className="flex flex-wrap gap-1.5 pt-0">
                {customer.tags.map((tag) => (
                  <Badge key={tag} tone="info" icon={<Tag className="size-3" />}>
                    {tag}
                  </Badge>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* Activity timeline */}
        <Card>
          <CardHeader title="Activity Timeline" description="Communications, viewings and proposals" />
          <CardBody className="pt-0">
            {activities.length === 0 ? (
              <EmptyState title="No activity yet" description="Interactions with this customer will appear here." />
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

        {/* Related records */}
        <div className="flex flex-col gap-4">
          <RelatedCard
            title="Leads"
            count={leads.length}
            emptyLabel="No leads"
            items={leads.slice(0, 5).map((lead) => ({
              id: lead.id,
              href: `/leasing/leads/${lead.id}`,
              primary: lead.propertyName ?? lead.code,
              secondary: lead.code,
              badge: <StatusBadge status={lead.stageColor === 'success' ? 'won' : 'info'} label={lead.stageLabel} dot={false} size="sm" />,
            }))}
          />
          <RelatedCard
            title="Viewings"
            count={viewings.length}
            emptyLabel="No viewings"
            items={viewings.slice(0, 5).map((viewing) => ({
              id: viewing.id,
              href: `/leasing/viewings`,
              primary: `${viewing.propertyName}${viewing.unitNumber ? ` · ${viewing.unitNumber}` : ''}`,
              secondary: formatDate(viewing.scheduledDate, { locale, style: 'short' }),
              badge: <StatusBadge status={viewing.status} dot={false} size="sm" />,
            }))}
          />
          <RelatedCard
            title="Proposals"
            count={proposals.length}
            emptyLabel="No proposals"
            items={proposals.slice(0, 5).map((proposal) => ({
              id: proposal.id,
              href: `/leasing/proposals/${proposal.id}`,
              primary: `${proposal.reference} (v${proposal.version})`,
              secondary: formatCurrency(Number(proposal.annualRent), { locale }),
              badge: <StatusBadge status={proposal.status} dot={false} size="sm" />,
            }))}
          />
          <RelatedCard
            title="Reservations"
            count={reservations.length}
            emptyLabel="No reservations"
            items={reservations.slice(0, 5).map((reservation) => ({
              id: reservation.id,
              href: `/leasing/reservations`,
              primary: `Unit ${reservation.unitNumber}`,
              secondary: `Expires ${formatDate(reservation.expiryDate, { locale, style: 'short' })}`,
              badge: <StatusBadge status={reservation.status} dot={false} size="sm" />,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function RelatedCard({
  title,
  count,
  emptyLabel,
  items,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  items: Array<{ id: string; href: string; primary: string; secondary: string; badge: React.ReactNode }>;
}) {
  return (
    <Card>
      <CardHeader title={title} action={<span className="text-[11px] text-[var(--color-text-tertiary)]">{count}</span>} />
      {items.length === 0 ? (
        <div className="px-5 pb-4 text-[12px] text-[var(--color-text-tertiary)]">{emptyLabel}</div>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-2 px-5 py-2.5 transition-colors hover:bg-[var(--color-surface-muted)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--color-text-primary)]">
                    {item.primary}
                  </span>
                  <span className="block text-[11px] text-[var(--color-text-tertiary)]">{item.secondary}</span>
                </span>
                {item.badge}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

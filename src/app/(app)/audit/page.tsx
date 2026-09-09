import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { AuditFilters } from '@/features/admin/audit-filters';
import { requirePermission } from '@/lib/auth/guard';
import { formatDateTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { listAuditEntityTypes, listAuditLogs, listLoginAttempts } from '@/services/audit-service';

export const metadata: Metadata = { title: 'Audit & Security' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('audit:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const loginPage = Math.max(1, Number(params.loginPage) || 1);

  const [entityTypes, audit, logins] = await Promise.all([
    listAuditEntityTypes(user.organizationId),
    listAuditLogs({
      organizationId: user.organizationId,
      entityType: params.entityType,
      action: params.action,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      page,
      pageSize: PAGE_SIZE,
    }),
    listLoginAttempts(user.organizationId, { page: loginPage, pageSize: PAGE_SIZE }),
  ]);

  const buildHref = (targetPage: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v);
    q.set('page', String(targetPage));
    return `/audit?${q.toString()}`;
  };
  const buildLoginHref = (targetPage: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'loginPage') q.set(k, v);
    q.set('loginPage', String(targetPage));
    return `/audit?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Users & Permissions', href: '/users' }, { label: 'Audit & Security' }]}
        title="Audit & Security"
        subtitle="Immutable audit trail of sensitive changes and sign-in activity."
      />

      <Card>
        <CardHeader title="Audit Log" description={`${audit.total} event(s)`} />
        <div className="px-5 pb-3"><AuditFilters entityTypes={entityTypes} /></div>
        {audit.items.length === 0 ? (
          <EmptyState title="No audit events" description="Events matching the filters will appear here." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>When</TH><TH>Actor</TH><TH alignment="center">Action</TH><TH>Entity</TH><TH>Label</TH><TH>Reason</TH></TR>
                </THead>
                <TBody>
                  {audit.items.map((row) => (
                    <TR key={row.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(row.createdAt, { locale })}</TD>
                      <TD>{row.actorName ?? row.actorLabel ?? 'System'}</TD>
                      <TD alignment="center"><Badge tone="neutral" size="sm">{row.action.replace(/_/g, ' ')}</Badge></TD>
                      <TD className="capitalize text-[var(--color-text-secondary)]">{row.entityType.replace(/_/g, ' ')}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.entityLabel ?? '—'}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.reason ? row.reason.replace(/_/g, ' ') : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={audit.total} buildHref={buildHref} />
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Login Attempts" description={`${logins.total} attempt(s)`} />
        {logins.items.length === 0 ? (
          <EmptyState title="No login attempts" description="Sign-in activity for your organization will appear here." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>When</TH><TH>Email</TH><TH alignment="center">Result</TH><TH>Reason</TH><TH>IP</TH></TR>
                </THead>
                <TBody>
                  {logins.items.map((row) => (
                    <TR key={row.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(row.createdAt, { locale })}</TD>
                      <TD>{row.email}</TD>
                      <TD alignment="center"><Badge tone={row.successful ? 'success' : 'error'} size="sm">{row.successful ? 'Success' : 'Failed'}</Badge></TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.reason ?? '—'}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.ipAddress ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={loginPage} pageSize={PAGE_SIZE} total={logins.total} buildHref={buildLoginHref} />
          </>
        )}
      </Card>
    </div>
  );
}

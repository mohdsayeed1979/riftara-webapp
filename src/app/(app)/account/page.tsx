import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { DetailList, DetailRow, PageHeader } from '@/components/ui/page';
import { requireUser } from '@/lib/auth/guard';
import { MfaPanel } from '@/features/account/mfa-panel';
import { getMfaStatus } from '@/services/mfa-service';

export const metadata: Metadata = { title: 'My Account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser();
  const mfaStatus = await getMfaStatus(user.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My Account" subtitle="Your profile, roles and access." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardBody className="flex flex-col items-center py-8 text-center">
            <Avatar name={user.fullName} src={user.avatarUrl} size="lg" />
            <p className="mt-3 text-[16px] font-semibold text-[var(--color-text-primary)]">{user.fullName}</p>
            <p className="text-[12.5px] text-[var(--color-text-secondary)]">{user.jobTitle ?? '—'}</p>
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{user.email}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {user.roleNames.map((role) => (
                <Badge key={role} tone="gold">{role}</Badge>
              ))}
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Access" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Roles" value={user.roleNames.join(', ') || '—'} />
                <DetailRow label="Permissions" value={`${user.permissions.length} granted`} />
                <DetailRow label="Data Scope" value={user.scopedPropertyIds.length || user.scopedCityIds.length ? 'Scoped' : 'Organization-wide'} />
                <DetailRow label="Locale" value={user.locale === 'ar' ? 'Arabic' : 'English'} />
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Security" description="Sign-in attempts are monitored and logged. Contact your administrator to reset your password." />
            <CardBody className="pt-0">
              <MfaPanel initialStatus={mfaStatus} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

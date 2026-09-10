import { can } from '@/lib/auth/guard';
import type { SessionUser } from '@/lib/auth/session';
import type { DocumentEntityType } from '@/lib/documents/constants';
import { getEntityDocuments } from '@/services/document-service';
import { DocumentsPanel } from './documents-panel';

/**
 * Server wrapper that gates on `documents:view`, loads the entity's documents +
 * applicable categories, and renders the reusable DocumentsPanel. One component
 * is embedded on every entity detail page — no duplicated document logic.
 */
export async function EntityDocuments({
  user,
  entityType,
  entityId,
  locale,
}: {
  user: SessionUser;
  entityType: DocumentEntityType;
  entityId: string;
  locale: 'en' | 'ar';
}) {
  if (!can(user, 'documents:view')) return null;
  const { documents, categories } = await getEntityDocuments(user, entityType, entityId);
  return (
    <DocumentsPanel
      entityType={entityType}
      entityId={entityId}
      documents={documents}
      categories={categories}
      permissions={{
        canCreate: can(user, 'documents:create'),
        canManage: can(user, 'documents:manage'),
        canDelete: can(user, 'documents:delete'),
      }}
      locale={locale}
    />
  );
}

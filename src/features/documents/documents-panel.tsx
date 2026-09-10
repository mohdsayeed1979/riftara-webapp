'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Download, FileText, History, Lock, MoreHorizontal, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { ACCEPT_ATTRIBUTE, type DocumentEntityType } from '@/lib/documents/constants';
import { deleteDocumentAction, getDocumentVersionsAction } from '@/app/(app)/documents/actions';
import type { DocumentListItem, DocumentVersionItem } from '@/services/document-service';

interface Category { id: string; name: string; requiresExpiry: boolean }
interface Perms { canCreate: boolean; canManage: boolean; canDelete: boolean }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPanel({
  entityType,
  entityId,
  documents,
  categories,
  permissions,
  locale,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  documents: DocumentListItem[];
  categories: Category[];
  permissions: Perms;
  locale: 'en' | 'ar';
}) {
  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Files attached to this record."
        action={permissions.canCreate ? <UploadDialog entityType={entityType} entityId={entityId} categories={categories} /> : undefined}
      />
      {documents.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents" description="Uploaded files will appear here." />
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Category</TH>
                <TH>File</TH>
                <TH alignment="center">Version</TH>
                <TH>Uploaded By</TH>
                <TH alignment="end">Uploaded</TH>
                <TH alignment="end">Expiry</TH>
                <TH alignment="end">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {documents.map((doc) => (
                <TR key={doc.id}>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {doc.isConfidential ? <Lock className="size-3.5 text-[var(--color-warning)]" aria-label="Confidential" /> : null}
                      {doc.title}
                    </span>
                  </TD>
                  <TD className="text-[var(--color-text-secondary)]">{doc.categoryName ?? '—'}</TD>
                  <TD className="text-[var(--color-text-secondary)]">
                    {doc.fileName}
                    <span className="block text-[11px] text-[var(--color-text-tertiary)]">{formatBytes(doc.sizeBytes)}</span>
                  </TD>
                  <TD alignment="center">
                    <Badge tone="neutral" dot={false}>v{doc.version}</Badge>
                  </TD>
                  <TD className="text-[var(--color-text-secondary)]">{doc.uploadedByName ?? 'System'}</TD>
                  <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(doc.createdAt, { locale, style: 'short' })}</TD>
                  <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{doc.expiryDate ? formatDate(doc.expiryDate, { locale, style: 'short' }) : '—'}</TD>
                  <TD alignment="end">
                    <RowActions doc={doc} entityType={entityType} entityId={entityId} categories={categories} permissions={permissions} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}

function RowActions({
  doc,
  entityType,
  entityId,
  categories,
  permissions,
}: {
  doc: DocumentListItem;
  entityType: DocumentEntityType;
  entityId: string;
  categories: Category[];
  permissions: Perms;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | 'replace' | 'versions' | 'delete'>(null);
  const [pending, start] = useTransition();

  function remove() {
    start(async () => {
      const result = await deleteDocumentAction(doc.id);
      if (result.ok) { toast.success('Document deleted.'); setDialog(null); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Document actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <a href={`/api/v1/documents/${doc.id}/download`}><Download />Download</a>
          </DropdownMenuItem>
          {doc.hasHistory ? <DropdownMenuItem onSelect={() => setDialog('versions')}><History />Version history</DropdownMenuItem> : null}
          {permissions.canManage ? <DropdownMenuItem onSelect={() => setDialog('replace')}><RefreshCw />Replace (new version)</DropdownMenuItem> : null}
          {permissions.canDelete ? <DropdownMenuItem destructive onSelect={() => setDialog('delete')}><Trash2 />Delete</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {permissions.canManage ? (
        <UploadDialog
          entityType={entityType}
          entityId={entityId}
          categories={categories}
          supersedes={{ id: doc.id, title: doc.title }}
          open={dialog === 'replace'}
          onOpenChange={(o) => (o ? setDialog('replace') : setDialog(null))}
        />
      ) : null}

      <VersionsDialog documentId={doc.id} open={dialog === 'versions'} onOpenChange={(o) => (o ? setDialog('versions') : setDialog(null))} locale="en" />

      <Dialog open={dialog === 'delete'} onOpenChange={(o) => (o ? setDialog('delete') : setDialog(null))}>
        <DialogContent size="sm">
          <DialogHeader title="Delete document" description={`Delete "${doc.title}"? Previous versions are preserved and the file is retained for retention.`} />
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="button" variant="destructive" loading={pending} onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadDialog({
  entityType,
  entityId,
  categories,
  supersedes,
  open: controlledOpen,
  onOpenChange,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  categories: Category[];
  supersedes?: { id: string; title: string };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange?.(o) : setUncontrolledOpen(o));
  const isReplace = Boolean(supersedes);

  const formRef = useRef<HTMLFormElement>(null);
  const [categoryId, setCategoryId] = useState('');
  const [pending, start] = useTransition();
  const requiresExpiry = categories.find((c) => c.id === categoryId)?.requiresExpiry ?? false;

  function submit() {
    const formEl = formRef.current;
    if (!formEl) return;
    const data = new FormData(formEl);
    data.set('entityType', entityType);
    data.set('entityId', entityId);
    if (supersedes) data.set('supersedesId', supersedes.id);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) { toast.error('Choose a file to upload.'); return; }

    start(async () => {
      const res = await fetch('/api/v1/documents', { method: 'POST', body: data });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(isReplace ? 'New version uploaded.' : 'Document uploaded.');
        setOpen(false);
        formEl.reset();
        setCategoryId('');
        router.refresh();
      } else {
        toast.error(json?.error?.message ?? 'Upload failed.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          <Button><Upload />Upload</Button>
        </DialogTrigger>
      )}
      <DialogContent size="md">
        <DialogHeader
          title={isReplace ? 'Upload New Version' : 'Upload Document'}
          description={isReplace ? `Replaces "${supersedes?.title}". Metadata carries over; the previous version is preserved.` : 'Attach a file to this record.'}
        />
        <form ref={formRef}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Title" required>
              <Input name="title" maxLength={240} defaultValue={supersedes?.title} placeholder="e.g. Signed lease agreement" />
            </Field>
            {!isReplace ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Category">
                    <NativeSelect name="categoryId" value={categoryId} onChange={setCategoryId} placeholder="Uncategorized" options={categories.map((c) => ({ id: c.id, name: c.name }))} />
                  </Field>
                  <Field label="Expiry Date" required={requiresExpiry} hint={requiresExpiry ? 'Required for this category.' : undefined}>
                    <Input type="date" name="expiryDate" />
                  </Field>
                </div>
                <Field label="Description">
                  <Textarea name="description" rows={2} maxLength={5000} />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
                  <input type="checkbox" name="isConfidential" value="true" className="size-4" />
                  Mark as confidential (restricted access)
                </label>
              </>
            ) : null}
            <Field label="File" required hint="PDF, image, Word, Excel or CSV. Max 25 MB.">
              <input type="file" name="file" accept={ACCEPT_ATTRIBUTE} className="block w-full text-[13px] file:me-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-[var(--color-surface-alt)] file:px-3 file:py-1.5 file:text-[13px]" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="button" loading={pending} onClick={submit}>{isReplace ? 'Upload Version' : 'Upload'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({
  documentId,
  open,
  onOpenChange,
  locale,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: 'en' | 'ar';
}) {
  const [versions, setVersions] = useState<DocumentVersionItem[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) { setVersions(null); return; }
    start(async () => {
      const result = await getDocumentVersionsAction(documentId);
      if (result.ok) setVersions(result.data);
      else toast.error(result.error.message);
    });
  }, [open, documentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Version History" />
        <DialogBody>
          {pending && !versions ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Loading…</p>
          ) : versions && versions.length > 0 ? (
            <Table>
              <THead>
                <TR><TH alignment="center">Version</TH><TH>File</TH><TH>Uploaded By</TH><TH alignment="end">Date</TH><TH alignment="end">Download</TH></TR>
              </THead>
              <TBody>
                {versions.map((v) => (
                  <TR key={v.id}>
                    <TD alignment="center">
                      <Badge tone={v.isCurrentVersion ? 'success' : 'neutral'} dot={false}>v{v.version}{v.isCurrentVersion ? ' · Current' : ''}</Badge>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{v.fileName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{v.uploadedByName ?? 'System'}</TD>
                    <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(v.createdAt, { locale, style: 'short' })}</TD>
                    <TD alignment="end"><a href={`/api/v1/documents/${v.id}/download`} className="text-[var(--color-info)] hover:underline">Download</a></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No version history.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

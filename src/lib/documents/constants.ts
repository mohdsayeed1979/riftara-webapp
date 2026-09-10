/**
 * Client-safe document constants: the entity types documents can attach to, the
 * upload MIME allow-list, and filename sanitization. No server-only imports so
 * both the UI and the service/route can share them.
 */

export const DOCUMENT_ENTITY_TYPES = [
  'property',
  'building',
  'unit',
  'contract',
  'customer',
  'tenant',
  'asset',
] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export function isDocumentEntityType(value: unknown): value is DocumentEntityType {
  return typeof value === 'string' && (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Allow-list: business-document MIME types → their permitted extensions. */
export const ALLOWED_UPLOAD_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-excel': ['xls'],
  'text/csv': ['csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/msword': ['doc'],
};

/** Extensions that are always rejected regardless of the declared MIME type. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'ps1', 'sh', 'bash', 'js', 'mjs', 'cjs', 'vbs', 'vbe', 'wsf',
  'jar', 'msi', 'dll', 'scr', 'app', 'apk', 'py', 'rb', 'php', 'pl', 'html', 'htm', 'svg',
]);

export const ACCEPTED_UPLOAD_EXTENSIONS = Object.values(ALLOWED_UPLOAD_TYPES).flat();
export const ACCEPT_ATTRIBUTE = ACCEPTED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(',');

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Validates an upload against the allow-list, checking BOTH the declared MIME
 * type and the extension, and that they are consistent (so a `.exe` renamed to
 * `.pdf`, or a PDF MIME on a `.js` file, is rejected).
 */
export function validateUploadType(mimeType: string, filename: string): { ok: true } | { ok: false; reason: string } {
  const ext = extensionOf(filename);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: 'This file type is not permitted.' };
  }
  const allowedExts = ALLOWED_UPLOAD_TYPES[mimeType];
  if (!allowedExts) {
    return { ok: false, reason: `Unsupported file type "${mimeType}".` };
  }
  if (!allowedExts.includes(ext)) {
    return { ok: false, reason: 'The file extension does not match its type.' };
  }
  return { ok: true };
}

/** Strips any path components and unsafe characters from an uploaded filename. */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 200);
}

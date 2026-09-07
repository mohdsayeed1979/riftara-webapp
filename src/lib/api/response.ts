import { NextResponse } from 'next/server';
import { toErrorPayload } from '@/lib/errors';

/**
 * Standard API envelope for /api/v1.
 * Success: { data, meta? }   Failure: { error: { code, message, rule?, details? } }
 */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status: 200, ...init });
}

export function apiCreated<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function apiNoContent() {
  return new NextResponse(null, { status: 204 });
}

export function apiError(error: unknown) {
  const { payload, status } = toErrorPayload(error);
  return NextResponse.json({ error: payload }, { status });
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Parses and clamps pagination parameters from a request URL. */
export function readPagination(
  searchParams: URLSearchParams,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number; offset: number } {
  const maxPageSize = defaults.maxPageSize ?? 200;
  const page = Math.max(1, Number(searchParams.get('page')) || defaults.page || 1);
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, Number(searchParams.get('pageSize')) || defaults.pageSize || 25),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

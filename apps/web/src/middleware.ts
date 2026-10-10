/**
 * F-1911: while the maintenance flag names a route, that route renders the
 * maintenance page instead (URL unchanged, so a reload after the window
 * lands where the visitor was). Off unless EMBERS_MAINTENANCE_ROUTES is set;
 * see `lib/maintenance.ts`.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { MAINTENANCE_PATH, isUnderMaintenance, readMaintenance } from '@/lib/maintenance';

export function middleware(req: NextRequest): NextResponse {
  const flag = readMaintenance(process.env);
  const path = req.nextUrl.pathname;
  if (!isUnderMaintenance(path, flag)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = MAINTENANCE_PATH;
  url.search = `?from=${encodeURIComponent(path)}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: never static assets, the BFF, the API or sign-in.
  matcher: ['/((?!_next/|bff/|api/|auth/|maintenance|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};

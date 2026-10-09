import type { ReactNode } from 'react';

import { AppFrame } from '@/components/shell/AppFrame';
import { signInAvailable } from '@/server/auth/config';
import { getPublicSession } from '@/server/auth/session';

/** Every in-app route renders inside the shell (PRD F-101 to F-103), with the visitor's session. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getPublicSession();
  return (
    <AppFrame user={user} signInAvailable={signInAvailable()}>
      {children}
    </AppFrame>
  );
}

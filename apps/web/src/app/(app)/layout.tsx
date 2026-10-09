import type { ReactNode } from 'react';

import { AppFrame } from '@/components/shell/AppFrame';

/** Every in-app route renders inside the shell (PRD F-101 to F-103). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}

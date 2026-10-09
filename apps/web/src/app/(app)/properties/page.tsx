import { redirect } from 'next/navigation';

/** PRD 7.3: `/properties` redirects to `/properties/search`. */
export default function Properties(): never {
  redirect('/properties/search');
}

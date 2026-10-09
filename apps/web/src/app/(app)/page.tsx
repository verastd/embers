import { redirect } from 'next/navigation';

/** Home (F-190) lands with its own feature; until then `/` opens the first shipped tool. */
export default function Home(): never {
  redirect('/properties/search');
}

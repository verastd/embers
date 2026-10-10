/**
 * The changelog (F-1906), taken from the repository's history: one entry per
 * change a visitor can see, with its date and the routes it touched. Until
 * the admin editor exists (F-2001), entries are added here with the change.
 */

export interface ChangelogEntry {
  /** YYYY-MM-DD (UTC) the change landed. */
  date: string;
  title: string;
  detail: string;
  features: string[];
  routes: ReadonlyArray<{ label: string; href: string }>;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-10-10',
    title: 'New player guide, changelog, feedback, about, troubleshooting and legal pages',
    detail:
      'A four-step guide for new players, this changelog, a feedback form, an about page, a troubleshooting page that checks the connection and clears local data, a maintenance page, and the privacy policy and terms.',
    features: ['F-1904', 'F-1906', 'F-1907', 'F-1908', 'F-1909', 'F-1910', 'F-1911'],
    routes: [
      { label: 'New player guide', href: '/new-player' },
      { label: 'Feedback', href: '/feedback' },
      { label: 'About', href: '/about' },
      { label: 'Troubleshoot', href: '/troubleshoot' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
  {
    date: '2026-10-09',
    title: 'Properties search: owner, listing, ask and markup filters',
    detail: 'Filter by current owner, whether a property is listed, the listing currency, the asking price and the markup over mint price, with Owner, Ask and Markup columns.',
    features: ['F-403'],
    routes: [{ label: 'Properties search', href: '/properties/search' }],
  },
  {
    date: '2026-10-09',
    title: 'Sign in with GitHub',
    detail: 'Sign in with a GitHub account. Public analytics stay open without an account.',
    features: ['F-301'],
    routes: [{ label: 'Log in', href: '/auth/login' }],
  },
  {
    date: '2026-10-09',
    title: 'Embers opens: app shell and properties search',
    detail:
      'The sidebar, a global search over properties and cities, UTC and Pacific clocks and a light, dark or system theme; and properties search by city, neighborhood, address, Upland status and mint price, read from the Upland chain.',
    features: ['F-101', 'F-102', 'F-103', 'F-403'],
    routes: [{ label: 'Properties search', href: '/properties/search' }],
  },
];

export interface ChangelogYear {
  year: string;
  entries: ChangelogEntry[];
}

/** Newest year first; newest entry first inside a year (stable for same-day entries). */
export function groupByYear(entries: readonly ChangelogEntry[]): ChangelogYear[] {
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? 1 : -1));
  const years: ChangelogYear[] = [];
  for (const { e } of sorted) {
    const year = e.date.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === year) last.entries.push(e);
    else years.push({ year, entries: [e] });
  }
  return years;
}

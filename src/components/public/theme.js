// src/components/public/theme.js — plain color palette, no 'use client'.
//
// Split out of shared.js specifically so server components (e.g.
// src/app/verify/[certNo]/page.js, which is server-rendered and reads
// C.dgrey etc. directly in its own JSX) can import it safely. Next's RSC
// bundler treats every export of a 'use client' file as a client
// reference — fine for components (NavBar, Footer, ...) rendered as a
// boundary, but a server component can't read a plain property off one
// (it's a reference placeholder in the server bundle, not real data),
// which is exactly the "Could not find module ... in Client Manifest"
// error this file exists to avoid. shared.js re-exports C from here so
// every existing client component that imports { C } from shared.js is
// unaffected.

export const C = {
  navy:   '#1B3A5C',
  navyD:  '#0D2238',
  navyL:  '#2E5F8A',
  gold:   '#C8960C',
  goldL:  '#E8B84D',
  white:  '#FFFFFF',
  offwt:  '#F0F4F8',
  lgrey:  '#E8ECF0',
  mgrey:  '#94A3B8',
  dgrey:  '#334155',
  green:  '#1E6B3C',
};

'use client';

import dynamic from 'next/dynamic';

// The app reads localStorage during render (session token), so it must never
// server-render. ssr:false keeps the whole tree browser-only, like the old SPA.
const App = dynamic(() => import('../src/App.jsx'), { ssr: false });

export default function Page() {
  return <App />;
}

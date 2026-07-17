import './globals.css';

export const metadata = {
  title: 'Business Website Lead Agent',
  description: 'Finds businesses with no website — never the same one twice.',
};

// maximum-scale/user-scalable lock the pinch zoom. iOS Safari ignores those
// for accessibility, so the 16px input rule in globals.css is what actually
// stops the focus auto-zoom there.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

export const metadata = {
  title: 'AACessTalk Backend',
  description: 'Next.js backend for the AACessTalk AAC tool',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

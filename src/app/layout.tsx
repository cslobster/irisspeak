export const metadata = {
  title: 'Iris Speak Backend',
  description: 'Next.js backend for the Iris Speak AAC tool',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

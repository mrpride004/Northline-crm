import './globals.css';

export const metadata = {
  title: 'Northline CRM',
  description: 'Internal order and dispatch management',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

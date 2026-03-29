export const metadata = {
  title: "RefactorPilot Platform",
  description: "Migration analytics, policy health, and marketplace operations.",
};

import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Diamond Claws (DCLAW) - These Claws Never Sell',
  description: 'The ultimate meme coin combining Diamond Hands conviction with OpenClaw agentic culture. Buy, stake, and HODL!',
  keywords: ['crypto', 'meme coin', 'DCLAW', 'Diamond Hands', 'staking', 'Web3'],
  icons: {
    icon: '/diamondclaw2.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

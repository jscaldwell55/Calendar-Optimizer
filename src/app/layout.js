import Providers from './providers';
import './globals.css';

export const metadata = {
  title: 'Calendar Scheduler',
  description: 'Schedule meetings with ease',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
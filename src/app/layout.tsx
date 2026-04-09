import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מערכת רישום לאירועים",
  description: "מערכת לרישום אמנים לאירועים",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col">
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200 bg-white/80">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 text-xs sm:text-sm text-slate-600 text-center flex items-center justify-center gap-2">
            <span>המערכת נבנתה על ידי נועם שואר</span>
            <a
              href="https://wa.me/972549065206"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="יצירת קשר ב-WhatsApp"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors shadow-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.05 4.94A9.9 9.9 0 0012.04 2C6.57 2 2.11 6.46 2.11 11.93c0 1.75.46 3.45 1.33 4.95L2 22l5.26-1.38a9.9 9.9 0 004.74 1.21h.01c5.47 0 9.93-4.46 9.93-9.93 0-2.66-1.03-5.16-2.89-6.96zm-7.04 15.2h-.01a8.2 8.2 0 01-4.18-1.14l-.3-.18-3.12.82.84-3.04-.2-.31a8.22 8.22 0 01-1.27-4.39c0-4.53 3.69-8.22 8.23-8.22 2.19 0 4.25.85 5.8 2.41a8.14 8.14 0 012.42 5.8c0 4.54-3.69 8.23-8.21 8.23zm4.51-6.15c-.25-.13-1.46-.72-1.69-.8-.23-.08-.4-.13-.57.13-.17.25-.65.8-.8.96-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.01-1.24-.74-.66-1.25-1.49-1.4-1.74-.15-.25-.02-.39.11-.52.11-.11.25-.28.37-.42.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.57-1.38-.78-1.88-.21-.5-.42-.43-.57-.44h-.49c-.17 0-.44.06-.66.31-.23.25-.87.85-.86 2.08.02 1.22.89 2.4 1.01 2.57.12.17 1.73 2.64 4.19 3.69.59.25 1.04.4 1.4.52.58.18 1.11.16 1.53.1.47-.07 1.46-.59 1.66-1.17.21-.58.21-1.08.15-1.17-.06-.1-.23-.16-.48-.29z" />
              </svg>
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}

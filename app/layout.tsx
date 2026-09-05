import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { FarmContextProvider } from "@/lib/farmContext";
import { PreferencesProvider } from "@/lib/preferences";
import { parsePrefsCookie } from "@/lib/preferences-core";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "AgriGate • Precision Agriculture IoT Dashboard",
  description:
    "Precision IoT monitoring and automated irrigation management for farms in Tunisia.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

// Pre-paint preference application — runs BEFORE first paint so a saved
// light/rtl preference never flashes the dark/english shell. Writes the
// agrigate_prefs cookie so the SERVER render (which cannot see localStorage)
// agrees with the client on the next navigation. suppressHydrationWarning on
// <html> tells React the attributes may have been adjusted pre-hydration.
const PRE_PAINT_SCRIPT = `(function(){try{
  var L=localStorage;
  var t=L.getItem('agrigate_theme');
  var l=L.getItem('agrigate_lang');
  var r=document.documentElement;
  if(t!=='light'){r.classList.add('dark');}else{r.classList.remove('dark');}
  if(l==='fr'||l==='ar'){r.lang=l;r.dir=(l==='ar')?'rtl':'ltr';}
  var m=('v1.'+(l==='fr'||l==='ar'?l:'en')+'.'+(t==='light'?'light':'dark'));
  document.cookie='agrigate_prefs='+m+'; path=/; max-age=31536000; samesite=lax';
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const { language, theme } = parsePrefsCookie(cookieStore.get("agrigate_prefs")?.value);

  return (
    <html lang={language} dir={language === "ar" ? "rtl" : "ltr"} className={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body className="bg-soil-950 text-parchment antialiased min-h-screen flex flex-col md:flex-row">
        {/* Shell (sidebar/topbar/mobile-nav) wraps everything EXCEPT /login */}
        <PreferencesProvider initialLanguage={language} initialTheme={theme}>
          <FarmContextProvider>
            <AppShell>{children}</AppShell>
          </FarmContextProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
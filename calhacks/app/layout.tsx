import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import AssistantPanel from "@/components/assistant/AssistantPanel";
import AssistantProvider from "@/components/assistant/AssistantProvider";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import "./globals.css";

// The type from the Figma design.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Back of House",
  description: "Restaurant back-office dashboard",
  applicationName: "Back of House",
  appleWebApp: { capable: true, title: "Back of House", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101010",
};

// Loads the restaurant's name for the sidebar.
async function RestaurantName() {
  const supabase = await getSupabase();
  const { data } = await supabase.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle();
  return <>{data?.name ?? "Restaurant"}</>;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
      // Chrome adds __gcrremoteframetoken to <html> before React loads. This app does not render that attribute.
      suppressHydrationWarning
    >
      {/* Dark shell: sidebar on the left, each page in a rounded white panel on the right (AppShell) */}
      <body className="min-h-full bg-gray-950 text-gray-800">
        {/* The AI assistant is on every page: the provider tracks the chat and the charts on screen */}
        <AssistantProvider>
          <AppShell
            restaurant={
              <Suspense fallback="Loading...">
                <RestaurantName />
              </Suspense>
            }
          >
            {children}
          </AppShell>
          <AssistantPanel />
        </AssistantProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AssistantPanel from "@/components/assistant/AssistantPanel";
import AssistantProvider from "@/components/assistant/AssistantProvider";
import Sidebar from "@/components/Sidebar";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Back of House",
  description: "Restaurant back-office dashboard",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Sidebar on the left, page content on the right */}
      <body className="flex min-h-full bg-gray-50 text-gray-900">
        {/* The AI assistant is on every page: the provider tracks the chat and the charts on screen */}
        <AssistantProvider>
          <Sidebar
            restaurant={
              <Suspense fallback="Loading...">
                <RestaurantName />
              </Suspense>
            }
          />
          <main className="min-w-0 flex-1 px-8 py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
          <AssistantPanel />
        </AssistantProvider>
      </body>
    </html>
  );
}

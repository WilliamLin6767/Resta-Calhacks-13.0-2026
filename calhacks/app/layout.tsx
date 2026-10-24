import type { Metadata } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import { Suspense } from "react";
import AssistantPanel from "@/components/assistant/AssistantPanel";
import AssistantProvider from "@/components/assistant/AssistantProvider";
import SectionMain from "@/components/SectionMain";
import Sidebar from "@/components/Sidebar";
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
    >
      {/* Dark shell: sidebar on the left, each page in a rounded white panel on the right */}
      <body className="flex min-h-full bg-gray-950 text-gray-800">
        {/* The AI assistant is on every page: the provider tracks the chat and the charts on screen */}
        <AssistantProvider>
          <Sidebar
            restaurant={
              <Suspense fallback="Loading...">
                <RestaurantName />
              </Suspense>
            }
          />
          <SectionMain>{children}</SectionMain>
          <AssistantPanel />
        </AssistantProvider>
      </body>
    </html>
  );
}

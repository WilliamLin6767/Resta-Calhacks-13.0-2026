import type { Metadata } from "next";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import LiveRefresh from "@/components/live/LiveRefresh";
import SubPageHeader from "@/components/SubPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { loadPricing } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { SuggestionCard } from "../parts";

export const metadata: Metadata = { title: "Suggested prices · Menu and pricing" };

async function Suggestions() {
  let data;
  try {
    data = await loadPricing(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const suggested = [...data.suggestions.filter((s) => s.action === "raise"), ...data.suggestions.filter((s) => s.action === "review")];
  return (
    <>
      <p className="mb-3 text-sm text-gray-600">
        Ingredient costs today vs. {data.since}. Target food cost: {Math.round(TARGET_FOOD_COST * 100)}% of the price.
      </p>
      {suggested.length === 0 ? (
        <div className="rounded-2xl border border-brand-100 bg-white">
          <EmptyState title="Every dish is priced fine right now." icon="tag" />
        </div>
      ) : (
        <div className="grid gap-3">
          {suggested.map((s) => <SuggestionCard key={s.dish.id} s={s} />)}
        </div>
      )}
    </>
  );
}

// Every suggested price; the Menu tab shows the top three.
export default function SuggestionsPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Menu and pricing", href: "/menu" }}
        title="Suggested prices"
        description="Dishes whose ingredient costs went up enough to reprice. Plain math, no AI. Nothing changes until you approve it."
      />
      <Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
        <Suggestions />
      </Suspense>
      <LiveRefresh topics={["menu"]} />
    </div>
  );
}

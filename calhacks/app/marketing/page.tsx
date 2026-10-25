import Link from "next/link";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import DraftButton from "@/components/marketing/DraftButton";
import PastPosts from "@/components/marketing/PastPosts";
import PostCard from "@/components/marketing/PostCard";
import PageHeader from "@/components/PageHeader";
import type { PostLayout } from "@/lib/marketing/copy";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

type Row = {
  id: number;
  layout: string;
  dish_name: string;
  headline: string;
  subhead: string;
  caption: string;
  hashtags: string[] | null;
  status: "draft" | "posted" | "failed" | "publishing" | "archived";
  error: string | null;
  external_link: string | null;
  photo_source?: string | null; // after 20_marketing_status.sql
  credit?: string | null;
  created_at: string;
};

const LAYOUTS = new Set<PostLayout>(["plate", "special", "night", "boost", "boost-poster", "poll", "poll-poster"]);

async function Posts({ searchParams }: { searchParams: PageProps<"/marketing">["searchParams"] }) {
  const showArchived = (await searchParams).archived === "1";
  const supabase = await getSupabase();
  const [restaurant, posts, uploads] = await Promise.all([
    supabase.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle(),
    supabase
      .from("marketing_posts")
      .select("*") // every column, so the photo credit shows once 20_marketing_status.sql has added it
      .eq("restaurant_id", RESTAURANT_ID)
      .order("created_at", { ascending: false }),
    supabase.storage.from("marketing").list("posts", { limit: 100 }),
  ]);
  if (posts.error) {
    const missing = /marketing_posts|schema cache/i.test(posts.error.message);
    return <ErrorMessage message={missing ? `${posts.error.message}. Has supabase/16_marketing.sql been run?` : posts.error.message} />;
  }

  const rows = (posts.data ?? []) as Row[];
  const current = rows.filter((row) => row.status !== "posted" && row.status !== "archived");
  const past = rows.filter((row) => row.status === "posted");
  const archived = rows.filter((row) => row.status === "archived");
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No posts yet. Draft this week and they show up here, ready to send.</p>;
  }

  const name = restaurant.data?.name ?? "Pho Berkeley";
  const ownPhotos = new Set((uploads.data ?? []).map((file) => file.name.replace(/\.jpg$/, "")));
  const card = (row: Row) => (
    <PostCard
      key={row.id}
      id={row.id}
      layout={LAYOUTS.has(row.layout as PostLayout) ? (row.layout as PostLayout) : "plate"}
      restaurant={name}
      dishName={row.dish_name}
      headline={row.headline}
      subhead={row.subhead}
      caption={row.caption}
      hashtags={row.hashtags ?? []}
      status={row.status}
      error={row.error}
      externalLink={row.external_link}
      ownPhoto={ownPhotos.has(String(row.id)) && row.photo_source !== "stock"}
      stockCredit={row.photo_source === "stock" ? (row.credit ?? "Stock photo, credit unknown") : null}
    />
  );

  return (
    <div>
      {current.length === 0 ? (
        <p className="text-sm text-gray-500">No drafts waiting. Draft this week to write a new set.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">{current.map(card)}</div>
      )}
      {past.length > 0 && <PastPosts count={past.length}>{past.map(card)}</PastPosts>}
      {archived.length > 0 && (
        <div className="mt-6">
          <Link href={showArchived ? "/marketing" : "/marketing?archived=1"} className="text-sm text-gray-600 underline-offset-2 hover:underline">
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </Link>
          {showArchived && <div className="mt-3 grid gap-4 lg:grid-cols-3">{archived.map(card)}</div>}
        </div>
      )}
    </div>
  );
}

export default function MarketingPage({ searchParams }: PageProps<"/marketing">) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Marketing"
          description="Quiet dishes from Analytics get a push. Dishes from Trends become a poll: comment ADD or SKIP."
        />
        <DraftButton />
      </div>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <Posts searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Badge from "@/components/Badge";
import PostFrame from "@/lib/marketing/frame";
import type { PostLayout } from "@/lib/marketing/copy";
import { ownPhotoUrl } from "@/lib/marketing/photoPath";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50";

export default function PostCard({
  id,
  layout,
  restaurant,
  dishName,
  headline,
  subhead,
  caption,
  hashtags,
  status,
  error,
  externalLink,
  photoSrc = null,
  stockCredit = null,
}: {
  id: number;
  layout: PostLayout;
  restaurant: string;
  dishName: string;
  headline: string;
  subhead: string;
  caption: string;
  hashtags: string[];
  status: "draft" | "posted" | "failed" | "publishing" | "archived";
  error: string | null;
  externalLink: string | null;
  photoSrc?: string | null;
  stockCredit?: string | null; // a stock photo: its credit line, added to the caption when posted
}) {
  const router = useRouter();
  const [dish, setDish] = useState(dishName);
  const [title, setTitle] = useState(headline);
  const [line, setLine] = useState(subhead);
  const [text, setText] = useState(caption);
  const [tags, setTags] = useState(hashtags.join(" "));
  const [loading, setLoading] = useState<"save" | "post" | null>(null);
  const [message, setMessage] = useState<string | null>(error);
  const [saved, setSaved] = useState(false);
  const [showPhoto, setShowPhoto] = useState(true);
  const [mine, setMine] = useState<string | null>(photoSrc);
  const [uploading, setUploading] = useState(false);
  const locked = status === "posted" || status === "publishing" || status === "archived" || loading !== null || uploading;

  // A new dish name brings the photo back (adjusting state during render, as React recommends,
  // instead of in an effect).
  const [photoFor, setPhotoFor] = useState(dish);
  if (photoFor !== dish) {
    setPhotoFor(dish);
    setShowPhoto(true);
  }

  function payload() {
    return { id, dishName: dish, headline: title, subhead: line, caption: text, hashtags: tags };
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("id", String(id));
      form.set("file", file);
      const res = await fetch("/api/marketing/photo", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setMine(typeof body.url === "string" ? body.url : `${ownPhotoUrl(id)}?v=${Date.now()}`);
      setShowPhoto(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  async function send(path: "/api/marketing/save" | "/api/marketing/publish") {
    setLoading(path.endsWith("save") ? "save" : "post");
    setMessage(null);
    setSaved(false);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      if (Array.isArray(body.hashtags)) setTags(body.hashtags.join(" "));
      if (path.endsWith("save")) setSaved(true);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(null);
    }
  }

  const tone = status === "posted" ? "green" : status === "failed" ? "red" : "gray";
  const label = { posted: "Posted", failed: "Failed", draft: "Draft", publishing: "Sending", archived: "Archived" }[status];
  const role = layout.startsWith("poll") ? "Poll · Trends" : layout.startsWith("boost") ? "Push · Analytics" : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
      <div className="bg-brand-50 p-4">
        <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-xl shadow-sm">
          <PostFrame
            layout={layout}
            restaurant={restaurant}
            dishName={dish}
            headline={title}
            subhead={line}
            size={320}
            photoUrl={showPhoto && mine ? mine : undefined}
            onPhotoError={() => {
              setMine(null);
              setShowPhoto(false);
            }}
          />
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-gray-900">{dish || "Untitled"}</p>
          <span className="flex items-center gap-2">
            {role && <Badge tone="amber">{role}</Badge>}
            {stockCredit && !mine?.includes("?v=") && <Badge tone="gray">Stock photo</Badge>}
            <Badge tone={tone}>{label}</Badge>
          </span>
        </div>
        {stockCredit && !mine?.includes("?v=") && <p className="text-xs text-gray-500">{stockCredit}. Added to the caption when it posts.</p>}
        {status !== "posted" && (
          <label className="inline-flex cursor-pointer rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
            {uploading ? "Adding photo..." : mine ? "Replace photo" : "Use your photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={locked}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void upload(file);
              }}
            />
          </label>
        )}
        <label className="block text-sm text-gray-600">
          Dish
          <input value={dish} onChange={(event) => setDish(event.target.value)} disabled={locked} className={field} />
        </label>
        <label className="block text-sm text-gray-600">
          Headline
          <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} className={field} />
        </label>
        <label className="block text-sm text-gray-600">
          Line under the headline
          <input value={line} onChange={(event) => setLine(event.target.value)} disabled={locked} className={field} />
        </label>
        <label className="block text-sm text-gray-600">
          Caption
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} disabled={locked} className={field} />
        </label>
        <label className="block text-sm text-gray-600">
          Hashtags
          <input value={tags} onChange={(event) => setTags(event.target.value)} disabled={locked} className={field} />
        </label>
        {status !== "posted" && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => send("/api/marketing/save")}
              disabled={locked}
              className="rounded border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
            >
              {loading === "save" ? "Saving..." : "Save edits"}
            </button>
            <button
              type="button"
              onClick={() => send("/api/marketing/publish")}
              disabled={locked || text.trim().length === 0}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {loading === "post" ? "Posting..." : "Post to Instagram"}
            </button>
          </div>
        )}
        {saved && <p className="text-sm text-gray-500">Saved. The preview above is what will be posted.</p>}
        {status === "posted" && externalLink && (
          <a href={externalLink} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 underline">
            View on Instagram
          </a>
        )}
        {status === "posted" && !externalLink && <p className="text-sm text-gray-500">Buffer is sending this to Instagram.</p>}
        {message && status !== "posted" && <p className="text-sm text-red-600">{message}</p>}
      </div>
    </article>
  );
}

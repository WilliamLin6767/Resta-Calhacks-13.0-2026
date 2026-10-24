import SectionMark from "@/components/SectionMark";

// The title and one-line description at the top of each page, with the section's colored icon.
export default function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6 flex items-start gap-4 md:mb-8">
      <SectionMark />
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-semibold tracking-[0.02em] text-gray-900 md:text-[34px]">{title}</h1>
        <p className="mt-1 line-clamp-2 text-sm text-gray-500 md:mt-2 md:line-clamp-none md:text-base">{description}</p>
      </div>
    </header>
  );
}

import SectionMark from "@/components/SectionMark";

// The title and one-line description at the top of each page, with the section's colored icon.
export default function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-8 flex items-start gap-4">
      <SectionMark />
      <div className="min-w-0">
        <h1 className="text-[34px] leading-tight font-semibold tracking-[0.02em] text-gray-900">{title}</h1>
        <p className="mt-2 text-base text-gray-500">{description}</p>
      </div>
    </header>
  );
}

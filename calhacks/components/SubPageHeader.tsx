import Link from "next/link";
import SectionMark from "@/components/SectionMark";

// The top of a page one level down (e.g. Inventory / Recent changes): a way back, then the title.
export default function SubPageHeader({ parent, title, description }: { parent: { label: string; href: string }; title: string; description: string }) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-gray-500">
        <Link href={parent.href} className="hover:text-gray-900 hover:underline">
          {parent.label}
        </Link>{" "}
        / <span className="text-gray-900">{title}</span>
      </nav>
      <header className="mb-6 flex items-start gap-4 md:mb-8">
        <SectionMark />
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold tracking-[0.02em] text-gray-900 md:text-[34px]">{title}</h1>
          <p className="mt-1 text-sm text-gray-500 md:mt-2 md:text-base">{description}</p>
        </div>
      </header>
    </>
  );
}

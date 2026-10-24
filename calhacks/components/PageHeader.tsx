// The title and one-line description at the top of each page.
export default function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </header>
  );
}

// Shows an error in red, e.g. when a Supabase query fails.
export default function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

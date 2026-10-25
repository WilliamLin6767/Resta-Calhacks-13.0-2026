// The same assistant on Fetch.ai's ASI:One (calhacks/agents). Opens a chat with it in ASI:One.
export const ASI_ONE_AGENT = "agent1qdsckutanf4g4q4clt4nfazwf4qn25nqtnsp8z4d65ahrf8hfn2kza9n5pr";
const AGENT_CHAT = `https://asi1.ai/ai/${ASI_ONE_AGENT}`;

export default function AsiOneLink({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm ${className}`}>
      <p className="min-w-0 flex-1 text-gray-600">
        <span className="font-medium text-gray-900">Also on ASI:One.</span> Ask what needs you, order what&apos;s low, or check your cash from
        Fetch.ai&apos;s ASI:One chat.
      </p>
      <a href={AGENT_CHAT} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-10 items-center rounded-md border border-brand-600 px-3 font-medium text-brand-700 hover:bg-brand-50 sm:min-h-8">
        Open in ASI:One ↗
      </a>
    </div>
  );
}

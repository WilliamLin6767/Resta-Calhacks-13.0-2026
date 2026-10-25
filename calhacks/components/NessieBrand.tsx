// Capital One's Nessie: the banking API behind the Accounting tab's bank account.
// The logo is Nessie's own (nessieisreal.com), which carries Capital One's swoosh. A plain <img>:
// it's a small file served from public/, so it doesn't need the image optimizer.
// Colors: Capital One's navy in light mode, a light blue in dark mode (navy is unreadable there).
/* eslint-disable @next/next/no-img-element */
export const NESSIE_URL = "https://nessieisreal.com";
const LOGO = "/brand/nessie.png";
const INK = "text-[#004879] dark:text-sky-300";
const TINT = "border-[#004879]/20 bg-[#004879]/5 dark:border-sky-300/25 dark:bg-sky-300/10";

// A small "Capital One Nessie" tag for numbers that come from the bank
export function NessieBadge({ label = "Capital One Nessie" }: { label?: string }) {
  return (
    <a href={NESSIE_URL} target="_blank" rel="noopener noreferrer" title="Capital One's Nessie banking API"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs font-medium hover:opacity-80 ${TINT} ${INK}`}>
      <img src={LOGO} alt="" width={20} height={20} className="rounded-full bg-white" />
      {label}
    </a>
  );
}

// The banner at the top of the bank section: what Nessie is and what it does here
export function NessieBanner({ last4, deposits }: { last4?: string; deposits?: number }) {
  const facts = [last4 ? `Account ····${last4}` : "", deposits ? `${deposits} payout deposits checked` : ""].filter(Boolean);
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${TINT}`}>
      <img src={LOGO} alt="Nessie by Capital One" width={44} height={44} className="shrink-0 rounded-lg bg-white" />
      <div className="min-w-0 flex-1 text-sm">
        <p className={`font-semibold ${INK}`}>Connected to Capital One through the Nessie banking API</p>
        <p className="text-gray-600">
          Each delivery payout is checked against its deposit in the account, and each move to savings is a Nessie transfer, so payouts and
          cash are checked against the bank itself.
        </p>
        {facts.length > 0 && <p className="mt-0.5 text-xs text-gray-500">{facts.join(" · ")}</p>}
      </div>
      <a href={NESSIE_URL} target="_blank" rel="noopener noreferrer" className={`shrink-0 text-xs font-medium underline ${INK}`}>
        About Nessie
      </a>
    </div>
  );
}

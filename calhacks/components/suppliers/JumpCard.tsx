"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import Reveal from "@/components/ui/Reveal";
import { telHref } from "@/lib/market/leads";

type Lead = {
  company_name: string;
  phone: string;
  city: string | null;
  state: string | null;
  matched_product: string | null;
};

const callClass = "lift inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto";

function CallLink({ label, phone }: { label: string; phone: string }) {
  return (
    <a href={telHref(phone)} className={callClass}>
      {label}
    </a>
  );
}

export default function JumpCard({
  ingredient,
  changePct,
  since,
  supplier,
  cheapestSupplier,
  impact,
  currentPhone,
  cheaperPhone,
  verdict,
  detail,
  calls,
  leadsMissing,
}: {
  ingredient: string;
  changePct: number;
  since: string;
  supplier: string;
  cheapestSupplier: string | null;
  impact: string | null;
  currentPhone: string | null;
  cheaperPhone: string | null;
  verdict: string;
  detail: string;
  calls: Lead[];
  leadsMissing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = currentPhone ? { label: `Call ${supplier}`, phone: currentPhone } : null;
  const cheaper = cheaperPhone && cheapestSupplier ? { label: `Call ${cheapestSupplier}`, phone: cheaperPhone } : null;
  const primary = cheaper ?? current;
  const other = current && primary && current.phone !== primary.phone ? current : null;

  return (
    <article className="rounded-2xl border border-brand-100 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{ingredient}</h3>
        <p className="text-sm text-gray-600">+{changePct}% since {since}</p>
      </div>

      <div className="hidden md:block">
        <p className="mt-1 text-sm text-gray-700">
          {supplier}
          {cheapestSupplier ? ` · cheaper on file: ${cheapestSupplier}` : ""}
          {impact ? ` · about ${impact} this period` : ""}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {currentPhone && <CallLink label={`Call ${supplier}`} phone={currentPhone} />}
          {cheaperPhone && cheapestSupplier && <CallLink label={`Call ${cheapestSupplier}`} phone={cheaperPhone} />}
        </div>
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-medium text-gray-800">{verdict}.</span> {detail}
        </p>
        <LeadList calls={calls} leadsMissing={leadsMissing} ingredient={ingredient} />
      </div>

      <div className="md:hidden">
        <p className="mt-1 line-clamp-2 text-sm text-gray-700">
          {supplier}
          {cheapestSupplier ? ` · cheaper on file: ${cheapestSupplier}` : ""}
        </p>
        {primary && (
          <div className="mt-3">
            <CallLink label={primary.label} phone={primary.phone} />
          </div>
        )}
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-3 min-h-11 text-sm font-medium text-gray-900 underline">
          {open ? "Less" : "More"}
        </button>
        {open && (
          <div className="mt-2">
            <p className="text-sm text-gray-700">
              {supplier}
              {cheapestSupplier ? ` · cheaper on file: ${cheapestSupplier}` : ""}
              {impact ? ` · about ${impact} this period` : ""}
            </p>
            {other && (
              <div className="mt-3">
                <CallLink label={other.label} phone={other.phone} />
              </div>
            )}
            <p className="mt-2 text-sm text-gray-600">
              <span className="font-medium text-gray-800">{verdict}.</span> {detail}
            </p>
            <LeadList calls={calls} leadsMissing={leadsMissing} ingredient={ingredient} />
          </div>
        )}
      </div>
    </article>
  );
}

function LeadList({ calls, leadsMissing, ingredient }: { calls: Lead[]; leadsMissing: boolean; ingredient: string }) {
  if (leadsMissing) return null;
  if (calls.length === 0) return <EmptyState title={`No food supplier with a phone was found for ${ingredient}.`} />;
  return (
    // Suppliers a new search finds rise in one after another
    <Reveal as="ul" className="mt-3 space-y-3 text-sm">
      {calls.map((lead) => (
        <li key={`${lead.company_name}-${lead.phone}`} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="font-medium">{lead.company_name}</span>
          <span className="text-gray-500">{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
          {lead.matched_product && <span className="text-gray-500">{lead.matched_product}</span>}
          <CallLink label={`Call ${lead.phone}`} phone={lead.phone} />
        </li>
      ))}
    </Reveal>
  );
}

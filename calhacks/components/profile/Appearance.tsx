"use client";

import { useEffect, useState } from "react";

const KEY = "resta-theme";
type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

const choices: { id: Theme; label: string; detail: string }[] = [
  { id: "light", label: "Light", detail: "White pages and a white sidebar." },
  { id: "dark", label: "Dark", detail: "The same layout, in dark surfaces." },
];

// Light or dark for the whole dashboard. The choice is remembered on this browser.
export default function Appearance() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  return (
    <section className="max-w-xl rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">Appearance</h2>
      <p className="mt-1 text-sm text-gray-600">Choose how the dashboard looks. This stays on this browser.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {choices.map((choice) => {
          const on = theme === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTheme(choice.id);
                applyTheme(choice.id);
              }}
              className={`rounded-xl border px-4 py-3 text-left ${
                on ? "border-brand-600 bg-brand-50" : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <span className="block text-sm font-semibold text-gray-900">{choice.label}</span>
              <span className="mt-1 block text-sm text-gray-600">{choice.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

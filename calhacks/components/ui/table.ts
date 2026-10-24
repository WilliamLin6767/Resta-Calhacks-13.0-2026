// Class names for tables, so hand-written <table>s look like SimpleTable (which uses these too).
// Numbers and money go in tdNum: right-aligned, with digits that line up.

export const tableWrap = "overflow-x-auto rounded-2xl border border-brand-100 bg-white";
export const table = "w-full text-left text-sm";
export const thead = "bg-brand-50";
export const th = "border-b border-brand-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-brand-700";
export const thNum = `${th} text-right`;
export const tr = "border-b border-gray-100 last:border-0 hover:bg-brand-50/60";
export const td = "px-3 py-2 text-gray-800";
export const tdNum = `${td} text-right tabular-nums`;

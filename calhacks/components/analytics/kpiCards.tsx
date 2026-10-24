// Builds the six KPI cards for KpiExplorer on the server: values, changes, details and
// a small picture for each. Only these pieces are sent to the browser, not the digest.

import type { Digest } from "@/lib/analytics";
import { getModule } from "@/lib/analyticsSections";
import { KPI_DEFS, buildWaterfall, kpiChange } from "@/lib/insights";
import { KPI_MODULE, formatKpiValue, kpiDetail } from "@/lib/kpiDetails";
import type { KpiCardData } from "./KpiExplorer";
import { DailyBars, FeeBars, PriceIncreaseList, PrimeCostBar, ProfitSteps } from "./KpiVisuals";

export function kpiCards(digest: Digest): KpiCardData[] {
  const { cur, prev } = digest.kpis;
  const visuals: Record<string, React.ReactNode> = {
    revenue: <DailyBars daily={digest.daily} />,
    revenue_per_open_day: <DailyBars daily={digest.daily} />,
    est_profit: <ProfitSteps steps={buildWaterfall(digest)} />,
    food_cost_pct: <PriceIncreaseList changes={digest.price_changes} />,
    prime_cost_pct: cur ? <PrimeCostBar kpis={cur} /> : null,
    platform_fees: <FeeBars channels={digest.channels} />,
  };
  return KPI_DEFS.map((def) => {
    const moduleDef = getModule(KPI_MODULE[def.key]);
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      value: formatKpiValue(def, cur),
      change: kpiChange(def, cur, prev),
      detail: kpiDetail(def, digest),
      module: { id: moduleDef.id, title: moduleDef.title },
      visual: visuals[def.key],
    };
  });
}

// Every playbook the loop runs. Adding a kind of problem means adding one here, not a new agent.
import { salesDip } from "./salesDip";
import { stockoutRisk } from "./stockoutRisk";
import { supplierPriceRise } from "./supplierPriceRise";
import type { Playbook } from "../types";

export const PLAYBOOKS: Playbook[] = [supplierPriceRise, salesDip, stockoutRisk];

export const playbookById = (id: string) => PLAYBOOKS.find((p) => p.id === id);

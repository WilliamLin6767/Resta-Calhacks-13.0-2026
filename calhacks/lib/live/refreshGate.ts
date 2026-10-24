// When <LiveRefresh> reloads the page (pure, so it can be tested with fake timers).
//
// - The first versions it sees are the starting point, not a change.
// - Bumps within DELAY_MS of the first one become one refresh.
// - Tab hidden: refresh once when it's visible again. Owner typing in a field: on blur.

export const DELAY_MS = 500;

export type RefreshGateEnv = {
  refresh: () => void;
  isHidden: () => boolean;
  isTyping: () => boolean;
};

export type RefreshGate = {
  versions: (next: Record<string, number>) => void;
  visible: () => void; // the tab became visible
  blur: () => void; // focus left a field
  dispose: () => void;
};

export function createRefreshGate(env: RefreshGateEnv, delayMs = DELAY_MS): RefreshGate {
  let last: Record<string, number> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: "visible" | "blur" | null = null;

  function fire() {
    timer = null;
    if (env.isHidden()) waiting = "visible";
    else if (env.isTyping()) waiting = "blur";
    else {
      waiting = null;
      env.refresh();
    }
  }

  return {
    versions(next) {
      if (last === null) {
        last = { ...next };
        return;
      }
      const prev = last;
      const up = Object.entries(next).some(([topic, version]) => version > (prev[topic] ?? 0));
      last = { ...prev, ...next };
      // Already waiting (a timer, or for the tab or a field): that refresh covers this bump too
      if (up && timer === null && waiting === null) timer = setTimeout(fire, delayMs);
    },
    visible() {
      if (waiting === "visible") fire();
    },
    blur() {
      if (waiting === "blur") fire();
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

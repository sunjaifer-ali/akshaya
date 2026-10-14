import { useEffect, useRef } from "react";

/** Reload while the tab is open. A hidden tab waits, and a slow reply is not started again. */
export function useRefresh(load: () => Promise<void> | void, ms: number, deps: readonly unknown[]) {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let stop = false;
    let busy = false;
    const run = () => {
      if (stop || busy || document.hidden) return;
      busy = true;
      void Promise.resolve()
        .then(() => loadRef.current())
        .finally(() => {
          busy = false;
        });
    };
    run();
    const timer = window.setInterval(run, ms);
    const onShow = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
    // The caller lists the values that should start a fresh reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

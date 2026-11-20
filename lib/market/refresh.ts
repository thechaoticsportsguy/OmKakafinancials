export const QUOTE_REFRESH_INTERVAL = 60 * 60 * 1000;

export function scheduleQuoteRefresh(refresh: (manual: boolean) => void, onSchedule: (at: number) => void) {
  let timer: ReturnType<typeof setTimeout>;
  let next = Date.now();

  function checkDue() {
    if (Date.now() < next) return;
    clearTimeout(timer);
    next = Date.now() + QUOTE_REFRESH_INTERVAL;
    onSchedule(next);
    function wake() {
      if (Date.now() < next) timer = setTimeout(wake, next - Date.now());
      else checkDue();
    }
    timer = setTimeout(wake, QUOTE_REFRESH_INTERVAL);
    refresh(false);
  }

  checkDue();
  return {
    checkDue,
    refreshNow: () => refresh(true),
    stop: () => clearTimeout(timer),
  };
}

/** The browser half of demo fast forward: an inline script placed first in
 *  `<head>` of a shifted demo page, so the tab's `Date.now()` and
 *  `new Date()` read the same shifted day as the server before any app
 *  module runs. Moving the date again or leaving the demo reloads the page.
 *
 *  The offset lives on `window.__ccClockOffset` and is read on every call,
 *  so `setClientClockOffset` can bring a page that was served without the
 *  script (the service worker's /cards shell) or a tab left behind by a
 *  fast forward in another tab onto the farm's date from layout data. */
export function clientClockScript(offsetMs: number): string {
  const off = Math.max(0, Math.floor(offsetMs));
  return (
    '<script>(function(){var w=window,o=' +
    off +
    ';if(!(o>0))return;w.__ccClockOffset=o;if(w.__ccClockInstalled)return;w.__ccClockInstalled=1;' +
    'var R=Date,n=R.now.bind(R);R.now=function(){return n()+(w.__ccClockOffset||0)};' +
    'w.Date=new Proxy(R,{construct:function(t,a,nt){' +
    'return Reflect.construct(t,a.length?a:[R.now()],nt)}})})();</script>'
  );
}

export interface ClockWindow {
  Date: DateConstructor;
  __ccClockOffset?: number;
  __ccClockInstalled?: number | boolean;
}

/** True on a demo farm whose date runs ahead of the real one, read from
 *  root layout data. Live weather is today's real weather, so pages that
 *  show it next to the demo date say so (#627). */
export function demoClockShifted(data: unknown): boolean {
  const demo = (data as { demo?: { offsetMs?: unknown } | null } | null | undefined)?.demo;
  return typeof demo?.offsetMs === 'number' && demo.offsetMs > 0;
}

/** The same shift as `clientClockScript`, applied from app code. A real
 *  farm (offset 0) on a tab that was never shifted is left untouched. */
export function setClientClockOffset(
  offsetMs: number,
  w: ClockWindow = globalThis as unknown as ClockWindow
): void {
  const o = Number.isFinite(offsetMs) ? Math.max(0, Math.floor(offsetMs)) : 0;
  if (!w.__ccClockInstalled && !(o > 0)) return;
  w.__ccClockOffset = o;
  if (w.__ccClockInstalled) return;
  w.__ccClockInstalled = 1;
  const R = w.Date;
  const n = R.now.bind(R);
  R.now = () => n() + (w.__ccClockOffset || 0);
  w.Date = new Proxy(R, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [R.now()], newTarget);
    }
  });
}

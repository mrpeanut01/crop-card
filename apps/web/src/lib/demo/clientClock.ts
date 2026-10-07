/** The browser half of demo fast forward: an inline script placed first in
 *  `<head>` of a shifted demo page, so the tab's `Date.now()` and
 *  `new Date()` read the same shifted day as the server before any app
 *  module runs. Moving the date again or leaving the demo reloads the page. */
export function clientClockScript(offsetMs: number): string {
  const off = Math.max(0, Math.floor(offsetMs));
  return (
    '<script>(function(){var o=' +
    off +
    ';if(!(o>0)||window.__ccClockOffset!==undefined)return;window.__ccClockOffset=o;' +
    'var R=Date,n=R.now.bind(R);R.now=function(){return n()+o};' +
    'window.Date=new Proxy(R,{construct:function(t,a,nt){' +
    'return Reflect.construct(t,a.length?a:[R.now()],nt)}})})();</script>'
  );
}

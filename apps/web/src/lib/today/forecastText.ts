import { t, type MessageKey } from '$lib/i18n';

const CORE: Record<string, string> = {
  sunny: 'sunny',
  'mostly sunny': 'mostlySunny',
  'partly sunny': 'partlySunny',
  clear: 'clear',
  'mostly clear': 'mostlyClear',
  'partly cloudy': 'partlyCloudy',
  'mostly cloudy': 'mostlyCloudy',
  cloudy: 'cloudy',
  rain: 'rain',
  'light rain': 'lightRain',
  'heavy rain': 'heavyRain',
  'rain showers': 'rainShowers',
  'light rain showers': 'lightRainShowers',
  showers: 'showers',
  drizzle: 'drizzle',
  thunderstorms: 'thunderstorms',
  'showers and thunderstorms': 'showersThunderstorms',
  snow: 'snow',
  'light snow': 'lightSnow',
  'heavy snow': 'heavySnow',
  'snow showers': 'snowShowers',
  'rain and snow': 'rainSnow',
  'rain and snow showers': 'rainSnowShowers',
  'freezing rain': 'freezingRain',
  'freezing drizzle': 'freezingDrizzle',
  sleet: 'sleet',
  fog: 'fog',
  'patchy fog': 'patchyFog',
  'areas of fog': 'areasFog',
  'dense fog': 'denseFog',
  haze: 'haze',
  smoke: 'smoke',
  frost: 'frost',
  'patchy frost': 'patchyFrost',
  'areas of frost': 'areasFrost',
  'blowing snow': 'blowingSnow',
  'blowing dust': 'blowingDust'
};

const PREFIXES: ReadonlyArray<[string, string]> = [
  ['slight chance ', 'slightChance'],
  ['chance ', 'chance'],
  ['isolated ', 'isolated'],
  ['scattered ', 'scattered']
];

function part(locale: string, phrase: string): string | null {
  let rest = phrase.trim();
  let mod: string | null = null;
  for (const [prefix, id] of PREFIXES) {
    if (rest.startsWith(prefix)) {
      mod = id;
      rest = rest.slice(prefix.length);
      break;
    }
  }
  if (!mod && rest.endsWith(' likely')) {
    mod = 'likely';
    rest = rest.slice(0, -' likely'.length);
  }
  const core = CORE[rest];
  if (!core) return null;
  const what = t(locale, `today.nws.core.${core}` as MessageKey);
  return mod ? t(locale, `today.nws.mod.${mod}` as MessageKey, { what }) : what;
}

export interface ForecastWords {
  text: string;
  /** 'en' when the text is NWS's English shown on a non-English page. */
  lang: 'en' | null;
}

/** An NWS short forecast in the viewer's language. Only phrases NWS uses
 *  that the catalog knows are translated; anything else stays NWS's
 *  English, marked so screen readers pronounce it as English. */
export function forecastWords(
  shortForecast: string | undefined | null,
  locale?: string | null
): ForecastWords | null {
  const english = (shortForecast ?? '').trim();
  if (!english) return null;
  if (!locale || locale === 'en') return { text: english, lang: null };
  const pieces = english.toLowerCase().replace(/\s+/g, ' ').split(' then ');
  const out: string[] = [];
  for (const p of pieces) {
    const w = part(locale, p);
    if (w === null) return { text: english, lang: 'en' };
    out.push(w);
  }
  let text = out[0];
  for (const next of out.slice(1)) text = t(locale, 'today.nws.then', { first: text, next });
  return { text: text.charAt(0).toUpperCase() + text.slice(1), lang: null };
}

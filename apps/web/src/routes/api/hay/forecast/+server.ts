/**
 * GET /api/hay/forecast?blockId=X
 *
 * Pulls the NOAA NWS 7-day forecast for a block's geometry centroid.
 * Cached server-side (1 hr TTL) per FR-22 and the NWS rate-limit guidance.
 *
 * If the block has no geometry, the caller may pass `lat` + `lon` query
 * params explicitly (so an operator without GPS can still use the gate).
 * If neither geometry nor explicit coords are available, returns 400.
 *
 * Inspector role can read; no mutation here.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { geometryCentroid, getForecast, WeatherFetchError } from '$lib/server/weather';

export const GET: RequestHandler = async ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  let lat = Number(url.searchParams.get('lat'));
  let lon = Number(url.searchParams.get('lon'));

  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && blockId) {
    const block = getBlock(blockId);
    if (!block) throw error(404, 'block not found');
    if (!block.geometryGeojson) {
      return json(
        {
          error:
            'block has no geometry and no lat/lon supplied; attach a polygon on /map or pass &lat=&lon=',
          blockId
        },
        { status: 400 }
      );
    }
    const centroid = geometryCentroid(block.geometryGeojson);
    if (!centroid) {
      return json({ error: 'block geometry is unparseable' }, { status: 400 });
    }
    lat = centroid.lat;
    lon = centroid.lon;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'lat + lon required (or a blockId with geometry)' }, { status: 400 });
  }

  try {
    const forecast = await getForecast(lat, lon);
    return json({ forecast, lat, lon });
  } catch (err) {
    if (err instanceof WeatherFetchError) {
      return json({ error: 'NWS upstream failed', detail: err.message }, { status: 502 });
    }
    throw err;
  }
};

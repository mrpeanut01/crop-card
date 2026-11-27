/** The satellite layer every map in the app displays. Display only: these
 *  tiles are loaded by the browser and are never sent to an AI service
 *  (Phase 38 owner ruling O-1). */
export const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_TILE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
export const TILE_NATIVE_MAX_ZOOM = 19;

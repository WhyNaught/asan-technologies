// Plain-language definitions for students and general audiences, keyed by variable id.
export const glossary: Record<string, string> = {
  'modis-lst': 'Daytime ground temperature measured from space by NASA’s MODIS sensor at about 1 km resolution (8-day composites; cloudy pixels are left out). Far sharper than the ~55 km model grid, so it shows hot and cool neighbourhoods inside a city.',
  temperature: 'How hot the ground itself is (not the air above it). Cities with lots of pavement and few plants usually have a higher skin temperature.',
  air: 'The temperature of the air about 2 m above the ground — what a weather thermometer in the shade reads.',
  humidity: 'How much water vapour the air holds compared with the most it could hold at that temperature. High humidity makes heat feel worse.',
  'dew-point': 'The temperature at which the air becomes saturated and dew forms. A higher dew point means muggier, more humid heat.',
  tmax: 'The hottest daytime air temperature, averaged over the month. Heatwaves push this up.',
  albedo: 'The fraction of sunlight the ground reflects. Snow and sand reflect a lot; dark forests and asphalt reflect little.',
  'root-wetness': 'How wet the soil is in the plant root zone, from 0 (bone dry) to 1 (saturated).',
  'surface-wetness': 'How wet the top few centimetres of soil are, from 0 (dry) to 1 (saturated). Reacts quickly to rain and heat.',
  evapotranspiration: 'Energy carried away as water evaporates from soil and transpires from plants. It falls when land dries out.',
  solar: 'Sunlight reaching the ground, averaged over the month.',
  longwave: 'Heat radiation arriving at the ground from the atmosphere and clouds. Greenhouse gases increase it.',
  oni: 'NOAA’s official El Niño / La Niña index: how much warmer (+) or cooler (−) the central tropical Pacific is than normal. Above +0.5 °C is El Niño; below −0.5 °C is La Niña.',
  vegetation: 'How green and dense the plants are (NDVI). Values near 1 mean thick vegetation; near 0 means bare ground.',
  'vegetation-anomaly': 'How much greener or browner than normal the plants are for that time of year.',
  drought: 'A score of how dry conditions are compared with normal; negative values mean drier than usual.',
  moisture: 'The fraction of soil volume that is water. Plants and crops depend on it.',
  precipitation: 'Average rain and snow rate (millimetres of water per day) over the month.',
  sst: 'Temperature of the top of the ocean. Swings in the tropical Pacific drive El Niño and La Niña. Only ocean areas have data.',
  wind: 'Average wind speed 10 metres above the ground.',
  'giovanni-aod': 'Aerosol optical depth estimates how much sunlight is blocked or scattered by particles throughout the atmospheric column. It is an aerosol indicator, not a direct measurement of ground-level PM2.5.',
  'giovanni-precipitation': 'Monthly GPM IMERG precipitation rate averaged over the selected area. Giovanni returns one area-averaged time series rather than per-pixel map values.',
};
export const methodNote = 'A trend is “significant” when it is unlikely (below the chosen α, usually 5%) to be just random ups and downs. The t-test assumes a straight-line trend with bell-shaped noise; the Mann-Kendall test makes no such assumption and only asks whether values tend to rise or fall over time.';
// Variable-specific warnings shown next to the trend verdict.
export const caution: Record<string, string> = {
  'modis-lst': 'Terra’s overpass time has drifted earlier since about 2020, which cools its daytime readings, so multi-year MODIS trends (especially a falling one) can be sensor artefacts rather than real change. Trust MODIS for spatial patterns inside a city and for the seasonal cycle, and cross-check any trend against NASA POWER skin temperature.',
  'giovanni-aod': 'Aerosol optical depth is a column-wide aerosol proxy, not ground-level PM2.5. Giovanni returns the average for the selected bounding box rather than individual map-cell values.',
  'giovanni-precipitation': 'This Giovanni series is averaged over the selected bounding box, and the available period depends on the underlying GPM product coverage.',
};

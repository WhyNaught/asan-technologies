import type { Phenomenon, Variable } from './types';
// Every variable comes from a connected real data source (`apiId` = the API variable or dataset id).
const v = (id: string, name: string, unit: string, layer: Variable['layer'], domain: [number, number], apiId: string, source: string, topic: string): Variable => ({ id, name, unit, layer, domain, global: true, apiId, source, topic, cadence: 'monthly' });
export const variables = {
  modis: v('modis-lst', 'Land surface temperature (MODIS, 1 km)', '°C', 'heat', [-10, 60], 'modis_lst', 'NASA MODIS MOD11A2 (1 km)', 'Temperature and atmosphere'),
  temperature: v('temperature', 'Earth skin temperature', '°C', 'heat', [-10, 50], 'earth_skin_temperature', 'NASA POWER', 'Temperature and atmosphere'),
  air: v('air', 'Air temperature (2 m)', '°C', 'scalar', [-30, 45], 'air_temperature', 'NASA POWER', 'Temperature and atmosphere'),
  tmax: v('tmax', 'Maximum air temperature (2 m)', '°C', 'heat', [-20, 50], 'max_air_temperature', 'NASA POWER', 'Temperature and atmosphere'),
  humidity: v('humidity', 'Relative humidity (2 m)', '%', 'scalar', [0, 100], 'relative_humidity', 'NASA POWER', 'Temperature and atmosphere'),
  dewPoint: v('dew-point', 'Dew point temperature (2 m)', '°C', 'scalar', [-20, 30], 'dew_point_temperature', 'NASA POWER', 'Temperature and atmosphere'),
  albedo: v('albedo', 'Surface albedo', 'fraction', 'scalar', [0, 0.9], 'surface_albedo', 'NASA POWER', 'Energy and land'),
  precipitation: v('precipitation', 'Precipitation', 'mm/day', 'scalar', [0, 15], 'precipitation', 'NASA POWER', 'Water and drought'),
  rootWet: v('root-wetness', 'Root-zone soil wetness', 'fraction', 'scalar', [0, 1], 'root_zone_soil_wetness', 'NASA POWER', 'Water and drought'),
  topWet: v('surface-wetness', 'Surface soil wetness', 'fraction', 'scalar', [0, 1], 'surface_soil_wetness', 'NASA POWER', 'Water and drought'),
  et: v('evapotranspiration', 'Evapotranspiration', 'W/m²', 'scalar', [0, 150], 'evapotranspiration', 'NASA POWER', 'Water and drought'),
  solar: v('solar', 'Surface solar irradiance', 'W/m²', 'scalar', [0, 350], 'solar_irradiance', 'NASA POWER', 'Energy and land'),
  longwave: v('longwave', 'Surface longwave irradiance', 'W/m²', 'scalar', [150, 450], 'longwave_irradiance', 'NASA POWER', 'Energy and land'),
  wind: v('wind', 'Wind speed (10 m)', 'm/s', 'scalar', [0, 12], 'wind_speed', 'NASA POWER', 'Energy and land'),
  sst: v('sst', 'Sea surface temperature', '°C', 'heat', [-2, 32], 'sea_surface_temperature', 'NOAA HadISST', 'Oceans and climate'),
  oni: v('oni', 'Oceanic Niño Index (Niño 3.4)', '°C anomaly', 'scalar', [-3, 3], 'nino34_index', 'NOAA CPC', 'Oceans and climate'),
  giovanniAod: { ...v('giovanni-aod', 'Aerosol optical depth (MODIS Aqua, 550 nm)', '1', 'scalar', [0, 1], 'MYD08_M3_6_1_Aerosol_Optical_Depth_Land_And_Ocean_Mean_Mean', 'NASA Giovanni · MODIS Aqua', 'Air quality and rainfall'), provider: 'giovanni', areaSeriesOnly: true },
  giovanniPrecipitation: { ...v('giovanni-precipitation', 'Precipitation rate (GPM IMERG)', 'mm/hr', 'scalar', [0, 15], 'GPM_3IMERGM_07_precipitation', 'NASA Giovanni · GPM IMERG', 'Air quality and rainfall'), provider: 'giovanni', areaSeriesOnly: true },
};
const groups: [string, [string, string, Variable[]][]][] = [
  ['Atmosphere', [
    ['Urban heat islands', 'Investigate how built environments retain heat.', [variables.modis, variables.temperature, variables.air, variables.humidity, variables.dewPoint, variables.albedo]],
    ['Heatwaves and humid heat', 'Explore prolonged heat and humidity.', [variables.modis, variables.tmax, variables.air, variables.humidity, variables.dewPoint]],
    ['Monsoon and rainfall shifts', 'Explore changes in seasonal rainfall and humidity.', [variables.precipitation, variables.humidity]],
    ['Air quality and rainfall (Giovanni)', 'Explore Giovanni aerosol and precipitation time series averaged over your selected area.', [variables.giovanniAod, variables.giovanniPrecipitation]],
  ]],
  ['Water', [
    ['Persistent drought', 'Follow sustained water deficits in rain, soil and evaporation.', [variables.precipitation, variables.rootWet, variables.topWet, variables.et]],
    ['Flash drought', 'Explore rapid losses of soil moisture.', [variables.topWet, variables.rootWet, variables.precipitation]],
  ]],
  ['Land and ecosystems', [
    ['Crop and vegetation stress', 'Explore how soil water, evaporation and heat stress growing regions.', [variables.rootWet, variables.et, variables.precipitation, variables.tmax]],
    ['Changing solar and wind resources', 'Investigate renewable energy conditions.', [variables.solar, variables.wind]],
    ['Surface brightening and darkening', 'Track how much sunlight the land reflects.', [variables.albedo, variables.solar]],
  ]],
  ['Oceans and coasts', [
    ['El Niño / La Niña', 'Connect tropical Pacific temperatures with regional rainfall and winds.', [variables.sst, variables.oni, variables.precipitation, variables.wind]],
    ['Marine heatwaves', 'Explore prolonged ocean warmth.', [variables.sst]],
  ]],
  ['Cryosphere and planetary systems', [
    ["Earth's energy balance", 'Examine sunlight and heat arriving at the surface.', [variables.solar, variables.longwave, variables.air]],
    ['Polar and permafrost warming', 'Explore warming ground and air in cold regions.', [variables.temperature, variables.air]],
  ]],
];
const featured = ['Urban heat islands', 'Persistent drought', 'El Niño / La Niña', 'Crop and vegetation stress'];
export const phenomena: Phenomenon[] = groups.flatMap(([category, items]) => items.map(([name, description, vars]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, category, description,
  why: `${description} All series are real NASA/NOAA data; correlation does not establish cause.`,
  variables: vars, defaultVariable: vars[0].id, scope: 'Point, selected region, or worldwide', temporalResolution: 'monthly', visualization: vars[0].layer, demo: true, featured: featured.includes(name),
})));
export const categories = groups.map(([name]) => name);

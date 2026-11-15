import type { Phenomenon, Variable } from './types';
const v = (id: string, name: string, unit: string, layer: Variable['layer'], domain: [number, number], global = true, apiId?: string): Variable => ({ id, name, unit, layer, domain, global, apiId });
export const variables = {
  temperature: v('temperature', 'Earth skin temperature', '°C', 'heat', [10, 45], false, 'earth_skin_temperature'),
  air: v('air', 'Air temperature', '°C', 'scalar', [5, 40], false, 'air_temperature'),
  nightLight: v('night-light', 'Night light radiance', 'nW/cm²/sr', 'scalar', [0, 80], false, 'night_light_radiance'),
  humidity: v('humidity', 'Relative humidity (2 m)', '%', 'scalar', [0, 100], false, 'relative_humidity'),
  dewPoint: v('dew-point', 'Dew point temperature (2 m)', '°C', 'scalar', [-10, 30], false, 'dew_point_temperature'),
  vegetation: v('vegetation', 'Vegetation cover', 'NDVI', 'scalar', [0, 1]),
  vegetationAnomaly: v('vegetation-anomaly', 'Vegetation anomaly', 'NDVI anomaly', 'anomaly', [-0.3, 0.3]),
  albedo: v('albedo', 'Surface reflectance', 'fraction', 'scalar', [0, 0.5], false),
  built: v('built', 'Built-up land cover', '%', 'polygon', [0, 100], false),
  drought: v('drought', 'Drought index', 'SPEI', 'anomaly', [-3, 3]),
  moisture: v('moisture', 'Soil moisture', 'm³/m³', 'scalar', [0, 0.5]),
  precipitation: v('precipitation', 'Precipitation anomaly', 'mm/month', 'anomaly', [-100, 100]),
  sst: v('sst', 'Sea surface temperature anomaly', '°C anomaly', 'temporal', [-3, 3]),
  wind: v('wind', 'Trade wind anomaly', 'm/s', 'vector', [-5, 5]),
};
const groups: [string, [string, string, Variable[]][]][] = [
  ['Atmosphere', [
    ['Urban heat islands', 'Investigate how built environments retain heat.', [variables.temperature, variables.air, variables.nightLight, variables.humidity, variables.dewPoint, variables.vegetation, variables.albedo, variables.built]],
    ['Heatwaves and humid heat', 'Explore prolonged heat and humidity.', [variables.air, variables.humidity, variables.dewPoint]],
    ['Wildfire smoke transport', 'Trace smoke particles through the atmosphere.', [v('pm25', 'Fine particulate matter', 'µg/m³', 'raster', [0, 100])]],
    ['Urban air pollution', 'Investigate air quality in growing cities.', [v('no2', 'Nitrogen dioxide', 'mol/m²', 'raster', [0, 0.001])]],
    ['Dust storms', 'Explore dust in the atmosphere.', [v('aod', 'Aerosol optical depth', 'AOD', 'raster', [0, 2])]],
    ['Atmospheric rivers', 'Follow concentrated atmospheric moisture.', [v('ivt', 'Integrated vapor transport', 'kg/m/s', 'vector', [0, 1000])]],
    ['Monsoon shifts', 'Explore changes in seasonal rainfall.', [variables.precipitation]],
    ['Tropical cyclones', 'Investigate storm tracks and wind intensity.', [v('storm-wind', 'Maximum sustained wind', 'm/s', 'point', [0, 80])]],
  ]],
  ['Water', [
    ['Persistent drought', 'Follow sustained water deficits and vegetation stress.', [variables.drought, variables.moisture, variables.vegetationAnomaly, variables.precipitation]],
    ['Flash drought', 'Explore rapid losses of soil moisture.', [variables.moisture]],
    ['River and urban flooding', 'Explore flood extent in vulnerable regions.', [v('flood', 'Flooded area', '%', 'polygon', [0, 100])]],
    ['Groundwater depletion', 'Investigate changes in water stored underground.', [v('groundwater', 'Water storage anomaly', 'cm', 'anomaly', [-30, 30])]],
    ['Shrinking lakes and reservoirs', 'Track changes in surface water extent.', [v('water', 'Surface water area', 'km²', 'polygon', [0, 100])]],
    ['Snowpack and snowmelt', 'Explore seasonal snow water storage.', [v('snow', 'Snow water equivalent', 'mm', 'raster', [0, 500])]],
    ['Landslide conditions', 'Inspect wet slopes and ground movement.', [variables.moisture]],
  ]],
  ['Land and ecosystems', [
    ['Crop and vegetation stress', 'Explore vegetation responses to water deficits.', [variables.vegetationAnomaly, variables.moisture]],
    ['Shifting growing seasons', 'Investigate changes in vegetation seasonality.', [variables.vegetation]],
    ['Deforestation and regrowth', 'Track forest canopy changes.', [v('forest', 'Tree cover', '%', 'raster', [0, 100])]],
    ['Wildfire damage and recovery', 'Examine fire detections and burned landscapes.', [v('fire', 'Fire radiative power', 'MW', 'point', [0, 300])]],
    ['Land degradation', 'Explore declining vegetation and exposed ground.', [variables.vegetationAnomaly]],
    ['Ecosystem productivity', 'Explore carbon uptake by vegetation.', [v('gpp', 'Gross primary production', 'g C/m²/day', 'scalar', [0, 12])]],
    ['Changing solar and wind resources', 'Investigate renewable energy conditions.', [v('solar', 'Surface solar irradiance', 'W/m²', 'scalar', [0, 400])]],
  ]],
  ['Oceans and coasts', [
    ['El Niño / La Niña', 'Connect tropical Pacific temperatures with regional rainfall.', [variables.sst, variables.precipitation, variables.wind]],
    ['Marine heatwaves', 'Explore prolonged ocean warmth.', [variables.sst]],
    ['Coral thermal stress', 'Investigate accumulated heat stress on reefs.', [v('dhw', 'Degree heating weeks', '°C-weeks', 'scalar', [0, 16])]],
    ['Ocean currents and upwelling', 'Explore surface ocean circulation.', [v('current', 'Surface current speed', 'm/s', 'vector', [0, 3])]],
    ['Phytoplankton blooms', 'Explore ocean chlorophyll concentrations.', [v('chlorophyll', 'Chlorophyll-a', 'mg/m³', 'raster', [0, 10])]],
    ['Sea-level rise', 'Investigate changes in sea surface height.', [v('sealevel', 'Sea level anomaly', 'mm', 'scalar', [-100, 100])]],
    ['Shoreline erosion', 'Explore movement of the land–sea boundary.', [v('shoreline', 'Shoreline displacement', 'm', 'polygon', [-50, 50])]],
  ]],
  ['Cryosphere and planetary systems', [
    ['Sea-ice changes', 'Explore polar sea ice extent and concentration.', [v('ice', 'Sea ice concentration', '%', 'raster', [0, 100])]],
    ['Glacier and ice-sheet changes', 'Investigate changes in ice thickness.', [v('glacier', 'Ice elevation change', 'm', 'raster', [-10, 10])]],
    ['Permafrost changes', 'Explore warming ground in cold regions.', [v('permafrost', 'Ground temperature', '°C', 'scalar', [-15, 5])]],
    ["Earth's energy balance", 'Examine incoming and outgoing planetary energy.', [v('energy', 'Net radiative flux', 'W/m²', 'scalar', [-10, 10])]],
    ['Methane hotspots and plumes', 'Explore atmospheric methane enhancements.', [v('methane', 'Methane enhancement', 'ppb', 'point', [0, 500])]],
    ['Land subsidence / uplift', 'Investigate vertical ground displacement.', [v('displacement', 'Vertical displacement', 'mm', 'raster', [-50, 50])]],
    ['Ocean acidification', 'Explore changing ocean carbonate chemistry.', [v('ph', 'Surface ocean pH', 'pH', 'scalar', [7.8, 8.3])]],
  ]],
];
const demos = ['Urban heat islands', 'Persistent drought', 'El Niño / La Niña', 'Crop and vegetation stress'];
export const phenomena: Phenomenon[] = groups.flatMap(([category, items]) => items.map(([name, description, vars]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, category, description,
  why: `${description} Understanding its spatial patterns helps frame questions about environmental change; these demonstrations cannot establish real-world impacts.`,
  variables: vars, defaultVariable: vars[0].id, scope: 'Point, selected region' + (vars[0].global ? ', or worldwide' : ''), temporalResolution: 'monthly', visualization: vars[0].layer, demo: demos.includes(name),
})));
export const categories = groups.map(([name]) => name);

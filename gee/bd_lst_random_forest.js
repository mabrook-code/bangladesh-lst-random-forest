var precipitation = ee.Image("OpenLandMap/CLM/CLM_PRECIPITATION_SM2RAIN_M/v01"),
    lst = ee.Image("OpenLandMap/CLM/CLM_LST_MOD11A2-DAY_M/v01"),
    pop = ee.ImageCollection("WorldPop/GP/100m/pop"),
    nasadem = ee.Image("NASA/NASADEM_HGT/001"),
    geometry = ee.FeatureCollection("projects/ee-mabrook1/assets/BD_admin_boundary"),
    landcover = ee.ImageCollection("MODIS/061/MCD12Q1"),
    ndvi = ee.ImageCollection("MODIS/061/MOD13A2");
// Precipitation Data
var rain = precipitation.reduce(ee.Reducer.sum()).toDouble().rename('rain');
Map.addLayer(rain.clip(geometry),{min:1437.18,max:5765.82, palette:['purple', 'blue', 'cyan','green', 'yellow', 'red']},'Rain');

// LST as label data
lst = lst.reduce(ee.Reducer.mean()).multiply(0.02).add(-273.15).rename('LST');
Map.addLayer(lst.clip(geometry), { min: 24.549500000000005, max: 30.125500000000063, palette: ['purple', 'blue', 'cyan', 'green', 'yellow', 'red']}, 'LST');

// Population Data
pop = pop.filterBounds(geometry).sort('system:time_start', false).first().rename('pop');
Map.addLayer(pop, { min: 0, max: 100, palette: ['black', 'red', 'white']}, 'Population', false);

// Elevation Data
var elevation = nasadem.select('elevation');
Map.addLayer(elevation.clip(geometry), { min: 10.22, max: 500.78, palette: ['green', 'yellow', 'red', 'white']}, 'Elevation', false);

// 5. NDVI (MODIS 2024 mean)
ndvi= ndvi.filterBounds(geometry)
  .select('NDVI')
  .mean() // Get mean NDVI over time
  .multiply(0.0001) // Scale factor for MODIS NDVI
  .rename('ndvi');
Map.addLayer(ndvi.clip(geometry), {min: 0, max: 0.8, palette: ['white', 'green']}, 'NDVI', false);

// 6. Land Cover (MODIS 2024)
landcover=landcover.filterBounds(geometry)
  .select('LC_Type1') // IGBP classification
  .first()
  .rename('landcover');
Map.addLayer(landcover.clip(geometry), {min: 0, max: 17, palette: ['black', 'yellow', 'green', 'blue']}, 'Land Cover', false);

// Water mask using JRC Global Surface Water (permanent water)
var water_mask = ee.Image("JRC/GSW1_4/GlobalSurfaceWater") // annual occurrence
  .select('occurrence')
  .gte(90) // pixels that are water at least 90% of the time
  .selfMask(); // mask non-water
Map.addLayer(water_mask.clip(geometry), {palette: ['blue']}, 'Permanent Water', false);

// Compute proximity (distance) to water
var proximity_to_water = water_mask.fastDistanceTransform(1000).sqrt().rename('proximity_to_water');
Map.addLayer(proximity_to_water.clip(geometry), {min: 0, max: 10000, palette: ['white', 'blue']}, 'Proximity to Water', false);

// Add every image as one
var combined = ee.Image([rain, lst, pop, elevation, ndvi, landcover, proximity_to_water]).updateMask(pop);

// Sample the data
var sample = combined.sample({
  numPixels: 10000,
  region : geometry,
  scale: 100,
  geometries: true
}).randomColumn();
Map.addLayer(sample, {}, 'Sample', false);

// Split into train and test
var train = sample.filter(ee.Filter.lte('random', 0.8));
var test = sample.filter(ee.Filter.gt('random', 0.8));
print('Train size', train.size(), 'Test size', test.size());

// Do random forest regression
var regression = ee.Classifier.smileRandomForest(100).train(train, 'LST', ['rain', 'elevation', 'pop', 'ndvi', 'landcover',  'proximity_to_water'])
  .setOutputMode('REGRESSION');
print('Regression RF', regression.explain());

// Make prediction
var predictionLST = combined.classify(regression, 'LST_Prediction');
Map.addLayer(predictionLST, { min: 0, max: 50, palette: ['purple', 'blue', 'cyan', 'green', 'yellow', 'red']}, 'LST Prediction');

// Classify the test data for accuracy test
var testData = test.classify(regression, 'LST_Prediction').map(function(data){
  return data.set('line', data.get('LST'));
});

// Show accuracy in chart
var chart = ui.Chart.feature.byFeature(testData, 'LST', ['line', 'LST_Prediction'])
  .setChartType('ScatterChart')
  .setOptions({
    dataOpacity: 0.3,
    title: 'LST Actual vs Prediction',
    hAxis: {
      title: 'LST Actual'
    },
    vAxis: {
      title: 'LST Prediction'
    },
    series: {
      0: {
        pointSize : 0,
        pointsVisible: false,
        visibleInLegend: false
      },
      1: {
        color: 'blue'
      }
    },
    trendlines: {
      0: {
        opacity: 1,
        type: 'linear',
        color: 'red',
        visibleInLegend: false
      },
      1: {
        opacity: 0.3,
        type: 'linear',
        showR2: true,
        color: 'blue',
        visibleInLegend: true
      }
    }
  });
print(chart);

// // 1. Export LST
// Export.image.toDrive({
//   image: lst.clip(geometry),
//   description: 'LST_toDrive',
//   folder: 'EarthEngineExports',
//   fileNamePrefix: 'LST_BD',
//   scale: 100,
//   region: geometry,
//   maxPixels: 1e13
// });

// // // 2. Export Rain
// // Export.image.toDrive({
// //   image: rain.clip(geometry),
// //   description: 'Rain_toDrive',
// //   folder: 'EarthEngineExports',
// //   fileNamePrefix: 'Rain_BD',
// //   scale: 100,
// //   region: geometry,
// //   maxPixels: 1e13
// });

// // 3. Export Population
// Export.image.toDrive({
//   image: pop.clip(geometry),
//   description: 'Pop_toDrive',
//   folder: 'EarthEngineExports',
//   fileNamePrefix: 'Population_BD',
//   scale: 100,
//   region: geometry,
//   maxPixels: 1e13
// });

// // 4. Export Elevation
// Export.image.toDrive({
//   image: elevation.clip(geometry),
//   description: 'Elevation_toDrive',
//   folder: 'EarthEngineExports',
//   fileNamePrefix: 'Elevation_BD',
//   scale: 100,
//   region: geometry,
//   maxPixels: 1e13
// });

// // 5. Export NDVI
// Export.image.toDrive({
//   image: ndvi.clip(geometry),
//   description: 'NDVI_toDrive',
//   folder: 'EarthEngineExports',
//   fileNamePrefix: 'NDVI_BD',
//   scale: 100,
//   region: geometry,
//   maxPixels: 1e13
// });

// 6. Export Land Cover
Export.image.toDrive({
  image: landcover.clip(geometry),
  description: 'Landcover_toDrive',
  folder: 'EarthEngineExports',
  fileNamePrefix: 'Landcover_BD',
  scale: 100,
  crs: 'EPSG:32646',
  region: geometry,
  maxPixels: 1e13});

// //7. Export the LST Prediction Raster
// Export.image.toDrive({
//   image: predictionLST.clip(geometry),
//   description: 'LST_Prediction_toDrive',
//   folder: 'EarthEngineExports',
//   fileNamePrefix: 'LST_Prediction_BD',
//   scale: 100, // Adjust scale to match your analysis
//   region: geometry,
//   maxPixels: 1e13
// });


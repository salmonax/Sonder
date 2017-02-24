const turf = require('@turf/turf');
const vis = require('code42day-vis-why');
const rtree = require('rtree');
const { clone } = require('cloneextend');
const Offset = require('polygon-offset');
const offset = new Offset();


/*** Utility functions for preparing boundary and centroid collections ***/

const visPercent = (flatCoords, percent) => {
  const pointCount = flatCoords.length;
  return vis(flatCoords,Math.round(pointCount*percent));
}
// Removes all but the exterior ring and simplifies with Visvalingam at 10%
const simpleFlat = (coords) => [visPercent(coords[0],0.10)];

// Separates a multi-poly into multiple uni-polys, runs union, and returns a new multi-poly
// This is in order to deal with cases in which overlapping multipolys break intersect()
const unifyMultiPoly = (multiPoly) => {
  const polys = multiPoly.geometry.coordinates.map(coords => turf.polygon(coords));
  let newPoly = turf.union(...polys);
  newPoly.properties = clone(multiPoly.properties);
  return newPoly;
}
exports.unifyMultiPoly = unifyMultiPoly;

exports.makeCentroidCollection = (featureCollection) => 
  turf.featureCollection(featureCollection.features.map(feature => 
    Object.assign(turf.centroid(feature),{ properties: { label: feature.properties.label } })
  ));

// These will take geoJSON regions, make a single giant poly out of them, and simplify
// Format: [{ collection: featureCollection, properties: { label: "San Francisco" } }]
exports.makeBoundaryCollection = (featureCollectionData) => {
  boundaryCollection = [];

  featureCollectionData.forEach((featureCollectionDatum, index) => {
    const featureCollection = featureCollectionDatum.collection;
    let feature = turf.union(...featureCollection.features);
    const type = feature.geometry.type;
    // Assume either MultiPolygon or Polygon and map accordingly
    feature.geometry.coordinates = (type === 'MultiPolygon') ?
      feature.geometry.coordinates.map(coords => simpleFlat(coords)) : 
      simpleFlat(feature.geometry.coordinates);

    // Apply given properties, if they exist
    feature.properties = featureCollectionDatum.properties || feature.properties;
    // Apply the index, just as in makeIndexedHoods:
    feature.properties.index = index;
    boundaryCollection.push(feature);
    console.log("Finished one.");
  });
  return turf.featureCollection(boundaryCollection);
}

/*** Utility functions for finding and indexing adjacent neighborhoods ***/

// Removes all but the exterior ring, bloats, and returns coords simplified to
//  the original pointCount
const simpleBloat = (coords) => {
  const outerRing = coords[0];
  const pointCount = outerRing.length;
  return [vis(offset.data([outerRing]).margin(0.0003)[0],pointCount)];
}

// Bloats and vis-simplifies to same polycount as source, using only outer rings
const bloatAndSimplify = (feature) => {
  // Deep clone the input to keep the function pure
  feature =  clone(feature);
  const coords = feature.geometry.coordinates;
  const type = feature.geometry.type;
  // Bloat each sub-poly individually if a multipoly
  feature.geometry.coordinates = (type === 'MultiPolygon') ?
    feature.geometry.coordinates.map(coords => simpleBloat(coords)) :
    simpleBloat(feature.geometry.coordinates);
  return (type === 'MultiPolygon') ? unifyMultiPoly(feature) : feature;
}
exports.bloatAndSimplify = bloatAndSimplify;

// Note: bloating is broken and false negatives never happen
exports.findAdjacentHoods = (currentHood, hoodFeatures) => {
  // Grows each poly first, to avoid false negatives:
  const bloatedHood = bloatAndSimplify(currentHood);
  var adjacentHoods = [];
  for (feature of hoodFeatures) {
    if (turf.intersect(bloatedHood, feature)) {
      adjacentHoods.push(feature);
    }
  }
  return adjacentHoods;
}

const growBBox = (bbox, d = 0.0000001) => [bbox[0]-d,bbox[1]-d,bbox[2]+d,bbox[3]+d];

exports.makeIndexedCollectionFast = (hoodCollection, opts) => {
  const start = Date.now();
  if (opts.pure) { hoodCollection = clone(hoodCollection); }
  const hoods = hoodCollection.features;
  const hoodTotal = hoods.length;
  console.log('Initializing adjacent neighborhoods properties');
  const tree = rtree(10);
  tree.geoJSON(hoodCollection);
  hoods.forEach((hood, index) => { 
    // optionally clean blockids
    if (opts.clean) delete hood.properties.blockids;
    // optionally simplify, with simplify argument being the minimum angle
    hood.properties.index = index;
    hood.properties.adjacents = [];
  });
  let counter = 0;
  for (let centerIndex = 0; centerIndex < hoodTotal; centerIndex++) {
    const centerHood = hoods[centerIndex];
    let centerBBox = growBBox( turf.bbox(centerHood) ); // avoid false negs
    centerBBox = [centerBBox.slice(0,2), centerBBox.slice(2)]; // convert bbox into tuples
    let candidates = tree.bbox(centerBBox);
    // candidates = Array.from(new Set(candidates).values()); // kill duplicates
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const candidateHood = candidates[candidateIndex];
      const adjacentIndex = candidateHood.properties.index;
      if (adjacentIndex === centerIndex) continue;
      if (centerHood.properties.adjacents.indexOf(adjacentIndex) !== -1) continue;
      if (turf.intersect(centerHood, candidateHood)) {
        counter++;
        centerHood.properties.adjacents.push(adjacentIndex);
        candidateHood.properties.adjacents.push(centerIndex);
      }
    }

    console.log("Finished "+centerIndex+' of '+hoodTotal+': "' + centerHood.properties.label+'"');
    console.log("Adjacent indices: " + centerHood.properties.adjacents);
  }
  console.log('Elapsed: '+(Date.now()-start)/1000+' seconds');
  console.log('Intersect called '+counter+' times.');
  // Simplify neighborhood polies using my simple angle-based algorithm
  // WARNING: turf.intersect MAY produce errors on the output of some of these polies!
  if (opts.simplify) {
    hoods.forEach(hood => {
      console.log('Simplifying ' + hood.properties.label + '...');
      hood.geometry.coordinates = (hood.geometry.type === 'MultiPolygon') ? 
        multiPolySimplify(hood.geometry.coordinates, opts.simplify) :
        [polySimplify(hood.geometry.coordinates[0], opts.simplify)];
    });
  }

  return hoodCollection;
}

exports.makeIndexedCollection = (hoodCollection, opts) => {
  const start = Date.now();
  if (opts.pure) { hoodCollection = clone(hoodCollection); }
  const hoods = hoodCollection.features;
  const hoodTotal = hoodCollection.features.length;
  console.log('Initializing adjacent neighborhoods properties');
  // Initialize adjacent properties, add index to make it a little less brittle
  hoods.forEach((hood, index) => { 
    hood.properties.index = index;
    hood.properties.adjacents = [];
  });
  let counter = 0;
  for (let centerIndex = 0; centerIndex < hoodTotal; centerIndex++) {
    const centerHood = hoods[centerIndex];
    for (let adjacentIndex = centerIndex+1; adjacentIndex < hoodTotal; adjacentIndex++) {
      const adjacentHood = hoods[adjacentIndex];
      if (centerHood.properties.adjacents.indexOf(adjacentIndex) !== -1) continue;
      if (turf.intersect(centerHood, adjacentHood)) {
        counter++;
        centerHood.properties.adjacents.push(adjacentIndex);
        adjacentHood.properties.adjacents.push(centerIndex);     
      }
    }
    console.log("Finished "+centerIndex+' of '+hoodTotal+': "' + centerHood.properties.label+'"');
    console.log("Adjacent indices: " + centerHood.properties.adjacents);
  }
  console.log('Elapsed: '+(Date.now()-start)/1000+' seconds');
  console.log('Intersect called '+counter+' times.');
  return hoodCollection;
}

const polySimplify = (polyline, minAngle = 0.1) => {
  let simplified = [];
  let maxIndex = polyline.length-1;
  for (let i = 2; i <= maxIndex; i++) {
    let one = [polyline[i-2],polyline[i-1]];
    let two = [polyline[i-1],polyline[i]];
    let angle = Math.abs(getBearing(one)-getBearing(two));
    if (i === 2) simplified.push(one[0]);
    if (angle > minAngle) simplified.push(two[0]);
    if (i === maxIndex) simplified.push(two[1]);
  }
  return simplified;
}

// This accepts a multiPoly array at the normal level, returns simplified outer rings only
const multiPolySimplify = (multiPoly, minAngle = 0.1) => {
  let simplified = [];
  for (poly of multiPoly) simplified.push([polySimplify(poly[0], minAngle)]);
  return simplified;
}

// Doubled up from MapHelpers.js for now

const getBearing = (line) => {
    const degrees2radians = Math.PI / 180;
    const radians2degrees = 180 / Math.PI;
    const { sin, cos, atan2 } = Math;
    const lng1 = degrees2radians * line[0][0];
    const lng2 = degrees2radians * line[1][0];
    const lat1 = degrees2radians * line[0][1];
    const lat2 = degrees2radians * line[1][1];
    const bearing = atan2(sin(lng2-lng1)*cos(lat2), 
                 cos(lat1)*sin(lat2)-sin(lat1)*cos(lat2)*cos(lng2-lng1))*radians2degrees;
    return (bearing < 0) ? 360+bearing : bearing;

};
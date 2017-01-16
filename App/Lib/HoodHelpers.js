const { clone } = require('cloneextend');
const intersect = require('@turf/intersect');
const simplify = require('@turf/simplify');
const Offset = require('polygon-offset');
const offset = new Offset();


exports.findAdjacentHoods = (currentHood, hoodFeatures) => {
  // This does an in-place grow on currentHood in order to find intersections
  // Not doing this can sometimes turn up false negatives when polys
  // don't fully overlap.
  // Note: Not yet working with MultiPolys.
  const bloatedHood = this.bloatAndSimplify(currentHood);
  var adjacentHoods = [];
  for (feature of hoodFeatures) {
    if (intersect(bloatedHood, feature)) {
      feature = clone(feature);
      // Simplifies with the D3-derived Visvalingam algorithm:
      // (Clone first to avoid changing source data)
      let pointCount = flatten(feature.geometry.coordinates).length/2;
      feature.geometry.coordinates[0] = vis(feature.geometry.coordinates[0],pointCount*0.5);
      adjacentHoods.push(feature);
    }
  }
  return adjacentHoods;
}
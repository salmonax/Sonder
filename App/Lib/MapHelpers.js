// @flow

import R from 'ramda'
import { centroid, bboxPolygon } from '@turf/turf';

export const removeEmpty = (markers: Array<Object>) => {
  let filteredMarkers = R.filter((item) => {
    return item.latitude && item.longitude
  }, markers)
  return filteredMarkers
}

// This returns an array of tuples in geoJSON format representing the region
// rectangle. ie. [[longitude, latitude]...]
export const getRegionBBox = (region: Object) => {
  const middleLong = region.longitude;
  const middleLat = region.latitude;
  const longDelta = region.longitudeDelta;
  const latDelta = region.latitudeDelta;

  const maxX = middleLong+longDelta;
  const minX = middleLong-longDelta;

  const maxY = middleLat+latDelta;
  const minY = middleLat-latDelta;
  // return region

  // Return rectangle ordered CCW from bottom right corner
  return [[maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

export const getPrettyBearing = (heading) => {
  const degreeChar = String.fromCharCode(176);
  const primaryCardinality = (heading >= 270 || heading <= 90) ? 'N' : 'S';
  const secondaryCardinality = (heading <= 180) ? 'E' : 'W';
  const angle = (heading <= 90) ? heading :
                   (heading <= 180) ? 180 - heading :
                     (heading <= 270) ? heading - 180 : 360 - heading;
 return primaryCardinality + angle + degreeChar + secondaryCardinality;
};

export const toCoords = (geojson: Array<Array>) => geojson.map((tuple) => ({
    longitude: tuple[0],
    latitude: tuple[1]
  })
);

export const toTuple = (coord: Object) => [coord.longitude, coord.latitude];

export const toTuples = (coords: Array<Object>) => coords.map((coords) => [coords.longitude, coords.latitude])

export var reverseTuples = (coordinates) => {
  return !Array.isArray(coordinates[0]) ?
    [coordinates[1], coordinates[0]] :
    coordinates.map((coordinate) => {
      return [coordinate[1], coordinate[0]];
    })
}

export const calculateRegion = (locations: Array<Object>, options: Object) => {
  const latPadding = options && options.latPadding ? options.latPadding : 0.1
  const longPadding = options && options.longPadding ? options.longPadding : 0.1
  const mapLocations = removeEmpty(locations)
  // Only do calculations if there are locations
  if (mapLocations.length > 0) {
    let allLatitudes = R.map((l) => {
      if (l.latitude && !l.latitude.isNaN) return l.latitude
    }, mapLocations)

    let allLongitudes = R.map((l) => {
      if (l.longitude && !l.longitude.isNaN) return l.longitude
    }, mapLocations)

    let minLat = R.reduce(R.min, Infinity, allLatitudes)
    let maxLat = R.reduce(R.max, -Infinity, allLatitudes)
    let minLong = R.reduce(R.min, Infinity, allLongitudes)
    let maxLong = R.reduce(R.max, -Infinity, allLongitudes)

    let middleLat = (minLat + maxLat) / 2
    let middleLong = (minLong + maxLong) / 2
    let latDelta = (maxLat - minLat) + latPadding
    let longDelta = (maxLong - minLong) + longPadding

    // return markers
    return {
      latitude: middleLat,
      longitude: middleLong,
      latitudeDelta: latDelta,
      longitudeDelta: longDelta
    }
  }
}

export const calculateRegionCenter = (coordinates) => {
  const poly = {
    "type": "Feature",
    "properties": {},
    "geometry": {
      "type": "Polygon",
      "coordinates": [coordinates]
    }
  };
  return centroid(poly).geometry.coordinates;
}
/*
  hoodToAnnotations() takes a geoJSON feature containing a Polygon or MultiPolygon 
  and spits out an array of Mapbox annotations.
    Notes:
      1. It only uses the outer-ring of the feature (ie. no holes)
      2. It takes the outer hood feature, not the underlying geometry
      3. It always returns an array. This is so that it can be spread unconditionally (see example)
  
    Example usage:
    --------------
    const addHoodAnnotation = (hoodFeature) => {
      const properties = hoodFeature.properties;
      const settings = {
        strokeColor: '#00FB00',
        fillColor: generateCoolColorFromLabel(properties.label),
        title: properties.label
      });      

      this.setState({
        annotations: [...annotations, 
          ...hoodToAnnotations(hoodFeature, settings)]
        ]
      })
    }
*/

// For debugging purposes, converts an array of tuple-ized BBoxes into polyLine annotations
export const boundsToAnnotations = (boundsSets) => {
  const annotations = [];
  boundsSets.forEach((bounds, index) => {
    // console.tron.log('BOUNDS: '+JSON.stringify(bounds));
    let bbox = bounds.reduce((result,tuple) => result.concat(tuple),[]);
    // console.tron.log('BBOX: '+JSON.stringify(bbox));
    let feature = bboxPolygon(bbox);
    let coords = feature.geometry.coordinates;
    annotations.push({
      coordinates: reverseTuples(coords[0]),
      type: 'polyline',
      class: 'compassBounds',
      id: 'compassBounds-'+index,
      strokeWidth: 2,
      strokeColor: "#0000FF"
    });
  });
  return annotations;
}


// Converts an OSM street LineString to a single polyline annotation
export const streetToAnnotation = (feature, annotationSettings) => {
  const coords = feature.geometry.coordinates;
  const id = feature.properties['@id'];
  return Object.assign(
    { coordinates: reverseTuples(coords),
      type: 'polyline',
      id
    },
    annotationSettings,
  );
}

// Converts a Zetashapes/Flickr neighborhood to one or more polygon annotations
export const hoodToAnnotations = (feature, annotationSettings) => {
  const type = feature.geometry.type;
  if (type === 'MultiPolygon') {
    console.tron.log('DANGER WILL ROBINSON: MultiPolygon is trying to be rendered!');
  }
  const properties = feature.properties;
  const coords = feature.geometry.coordinates;
  const mergeSettings = (coords, index = 0) =>
    Object.assign(
      { coordinates: reverseTuples(coords[0]),
        type: 'polygon' }, 
      annotationSettings,
      { id: annotationSettings.id+' '+index }
    );
  return (type === 'MultiPolygon') ? 
    coords.map((coords, index) => mergeSettings(coords, index)) :
    [mergeSettings(coords)];
};

const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export const binduMapBox = (text) => {
  // sums the ascii values of each character in the stat to use as seed
  let seed = text.split('').reduce( function(sum,item,i) { return sum + item.charCodeAt()*i+2 },0);
  const color = {
    r: parseInt(seededRandom(seed)*100+50),
    g: parseInt(seededRandom(++seed)*100+50),
    b: parseInt(seededRandom(++seed)*100+100)
  };
  return '#'+color.r.toString(16)+color.g.toString(16)+color.b.toString(16);
};

// This takes a bounds array and splits it n number of times
// It returns an array of bounds arrays

export const splitBBox = (bbox) => {
  var deltaX = Math.abs(bbox[1][0]-bbox[0][0]);
  var deltaY = Math.abs(bbox[1][1]-bbox[0][1]);
  var leftX = bbox[0][0];
  var rightX = bbox[1][0];
  var topY = bbox[0][1];
  var bottomY = bbox[1][1];
  var midX = bbox[0][0] + deltaX/2;
  var midY = bbox[0][1] + deltaY/2;

  var topLeft = bbox[0];
  var topMid = [ midX, topY ]
  var topRight = [ rightX, topY ];
  var midLeft = [ leftX , midY ];
  var midMid = [ midX, midY ];
  var midRight = [ rightX, midY ];
  var bottomLeft = [ leftX, bottomY ];
  var bottomMid = [ midX, bottomY ];
  var bottomRight = bbox[1];

  return [
    [topLeft, midMid],
    [topMid, midRight],
    [midLeft, bottomMid],
    [midMid, bottomRight]
  ];
};

const lineIntersect = (lng1, lat1, lng2, lat2, lng3, lat3, lng4, lat4) => {
    var ua, ub, denom = (lat4 - lat3)*(lng2 - lng1) - (lng4 - lng3)*(lat2 - lat1);
    if (denom === 0) return null;
    ua = ((lng4 - lng3)*(lat1 - lat3) - (lat4 - lat3)*(lng1 - lng3))/denom;
    ub = ((lng2 - lng1)*(lat1 - lat3) - (lat2 - lat1)*(lng1 - lng3))/denom;
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) ?
        [ lng1 + ua*(lng2 - lng1), lat1 + ua*(lat2 - lat1) ] : 
        false;
}


// const getDistance = (lng1, lat1, lng2, lat2) => {
//     const { acos, sin, cos } = Math;
//     return acos(sin(lat1)*sin(lat2)+cos(lat1)*cos(lat2)*cos(lng2-lng1))*3959;
// }

function getDistance(lng1, lat1, lng2, lat2) {
  var radlat1 = Math.PI * lat1/180;
  var radlat2 = Math.PI * lat2/180;
  var theta = lng1-lng2;
  var radtheta = Math.PI * theta/180;
  var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
  dist = Math.acos(dist);
  dist = dist * 180/Math.PI;
  dist = dist * 60 * 1.1515;
  return dist;
}

// Takes an array of lngLats, returns collision and distance
// Note: this will probably be a little faster without all the spreads
export const polyIntersect = (line, polyline) => {
    var result = false;
    var nearest;
    for (let i = 1; i < polyline.length; i++) {
        let segment = [polyline[i-1],polyline[i]];
        let collision = lineIntersect(...[].concat(...line), ...[].concat(...segment));
        if (collision) {
            let distance = getDistance(...line[0],...collision);
            if (nearest === undefined || distance < nearest) {
                nearest = distance;
                result = { collision, segment, distance };
            }
        }
    }
    return result;
};

// accepts coordinates at normal mulitPoly levels and runs polyIntersect
// returns the nearest of each
export const multiPolyIntersect = (line, multiPoly) => {
  // console.tron.log('MULTIPOLY CALLED');
  var result = false;
  var nearest;
  // Grabs only the outer shape of each poly
  // mulitPoly = multiPoly.map(coords => coords[0]);
  for (poly of multiPoly) {
    let candidate = polyIntersect(line,poly[0]);
    if (candidate) {
      let distance = candidate.distance;
      if (nearest === undefined || distance < nearest) {
        nearest = distance;
        result = candidate;
      }
    }
  }
  return result;
}

// returns the acute angle between two lngLat tuples in degrees
export const getBearing = (line) => {
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
export const getAngle = (one, two) => {
    const bearing1 = getBearing(one);
    const bearing2 = getBearing(two);
    const angle = (bearing2 > bearing1) ? bearing2-bearing1 : bearing1-bearing2;
    // return angle;
    return Math.abs((angle <= 90) ? angle : 180-angle);
}

// export const getAngle = (first, second) => {
//     var m1 = (first[1][1]-first[0][1])/(first[1][0]-first[0][0]);
//     var m2 = (second[1][1]-second[0][1])/(second[1][0]-second[0][0]);
//     var angle = Math.atan((m1 - m2) / (1 - (m1 * m2)));
//     return Math.abs(angle*180/Math.PI);
// };

// Similar to growBBox from Geohelpers, but takes tuples as input/output
export const growBounds = (bounds, d = 0.0005) => [[bounds[0][0]-d,bounds[0][1]-d],[bounds[1][0]+d,bounds[1][1]+d]];

export const overpassToLineString = (item) => {
  const id = item.type+'/'+item.id;
  return { 
    type: 'Feature',
    id: id,
    properties: Object.assign({},{ ['@id']: id },item.tags),
    geometry: {
      type: 'LineString',
      coordinates: item.geometry.map(coord => [coord.lon, coord.lat])
    }
  }
}

export const milesToSteps = (miles, height = 70) => 
                              miles*5280/(height/12*0.413);

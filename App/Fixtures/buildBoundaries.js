const { makeBoundaryCollection } = require('./geoHelpers');
const fs = require('fs');

const data = [
  { collection: require('./raw/sanFrancisco.json'), properties: { label: "San Francisco" } },
  { collection: require('./raw/siliconValley.json'), properties: { label: "Silicon Valley" }},
  { collection: require('./raw/southSF.json'), properties: { label: "South San Francisco" }},
  { collection: require('./raw/eastBay.json'), properties: { label: "East Bay"} }
];

// Assumes build directory exists
console.log('Processing...')
fs.writeFile('./bayAreaBoundaries.json', JSON.stringify( makeBoundaryCollection(data), null, 2));
console.log("File written to ./bayAreaBoundaries.json");

import inside from '@turf/inside';
import nextFrame from 'next-frame';
import { getRegionBBox, toCoords, toTuples, toTuple } from './MapHelpers';

const relPath = '../Fixtures/indexed/'
const regionFile = 'bayAreaBoundaries.json'
// These are in the same order as in buildBoundaries.js
const hoodFiles = [
  'sanFrancisco.json',
  'southSF.json',
  'eastBay.json',
  'siliconValley.json',
];

// This should probably go into MapHelpers:
const toPoint = (latLng) => ({ 
  type: 'Point', 
  coordinates: toTuple(latLng) 
});
/**
  This is used by the Compass to scope neighborhood queries.
  Conventions:
    Internal:
      - Features are extracted from feature collections for easier iteration
      - async/await/for-of/nextFrame pattern is shared with Compass
       -- this means, use for-of rather than forEach when possible,
          which works with async/await
      - To avoid confusion about geoJSON and mapbox tuples, LatLng
        objects are used for public methods and converted internally
      - More strictly than in the Compass, '_' denotes a method isn't for consumption
    Interface:
    - The consumer uses refresh(position), which pursues all logic from cheapest to most expensive
      -- See comments on refresh() for more detail
    - Assuming refresh() has been called, the consumer can access various getters

**/
class HoodSelector {
  constructor() {
    // Loads region boundaries unconditionally
    this._regions = require(relPath+regionFile).features;
    this._currentRegion = null;
  }

  init() {
    /* This is like refresh, kicks off the whole process
    1. Find what region we're in, set this._currentRegion
    2. Load the region, anticipating a wait
    3. Find the currentHood, set this._currentHood
    4. Peruse the currentHood's adjacents property, push all of them to this._adjacenHoods

    */

  }

  // async _findCurrentHood(position, hoodFeatures) {

  //   for (let feature of hoodFeatures) {
  //     const curPosGeo = point(toTuple(position.coords)).geometry;
  //     if (inside(curPosGeo, feature)) return feature;
  //     await nextFrame(); this.__frameCounter++;
  //   }
  // }

  // This is the main function that the rest of the logic exists for.
  // It returns this, so that it can be chained with any of the HoodSelector's public methods.
  /* Compass will do something like:
    onPositionChange, HoodSelector.refresh(position)
    refresh() will do the following:
      1. Check if the position is still in the this._currentHood (super-cheap)
      2. If not, then iterate through this._adjacentHoods and see which they're in (cheap)
        - set this._currentHood to the match
      3. If they are STILL not found, check _currentRegion as a sanity check (semi-cheap)
      4. If we're still in the same region, then repopulate this._currentHood from ALL hoods (expensive)
      5. If we're not, do a full region check and load the new region (most expensive)
  */
  refresh(position) {


  }

  // 
  // It should be called on user update and output all the indexed features to the consumer
  _selectAdjacentHoods() {


  }

  // This will always rely on the currently set 
  _findCurrentHood() {

  }

  // Find the user's region; return null if no region is found
  _findCurrentRegion(position) {
    posPoint = toPoint(position);
    for (let region of this._regions) {
      if(inside(posPoint, region)) {
        return region;
      }
    }
    return null;
  }

}


// Export instance, so we're always working from the same one
const hoodSelector = new HoodSelector();
export default hoodSelector;


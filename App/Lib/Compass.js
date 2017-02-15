/*
First-pass refactor of monolithic compass
------------------------------------------
ToDos:
- Put promises everywhere
- Make it work with batching optimizations,
    or use requestAnimationFrame, or something
- Refactor the neighborhood stuff out of here
- Add isReady() helper functions to go along with events
- Unit tests
*/

import { DeviceEventEmitter } from 'react-native';
import ReactNativeHeading from 'react-native-heading';
// Note: ignoring redux-saga structure for now, so this eventually shouldn't go in here!
import FixtureApi from '../Services/FixtureApi';

import { getRegionBBox, 
         toCoords, 
         toTuples, 
         toTuple, 
         splitBBox, 
         polyIntersect, 
         multiPolyIntersect,
         getAngle
       } from '../Lib/MapHelpers';
import { lineString, point, polygon } from '@turf/helpers';
import intersect from '@turf/intersect';
import inside from '@turf/inside';
import Offset from 'polygon-offset';
import turf from '@turf/turf';

import { clone } from 'cloneextend';
import vis from 'code42day-vis-why';
// import nextFrame from 'next-frame';

function smartFrame(fps) {
    let lastFrame;
    const minElapsed = 1000/fps;
    const requestFramePromise = (resolve, reject) => {
      var now = Date.now();
      if (lastFrame && (now-lastFrame) < minElapsed) {
        // console.tron.log('!NO ' + (now-lastFrame) + 'ms');
        resolve();
      } else {
        // console.tron.log('!YES ' + (now-lastFrame) + 'ms');
        lastFrame = now;
        requestAnimationFrame(() => resolve());  
      }
    };
    return () => new Promise(requestFramePromise);
}

const nextFrame = smartFrame(20);

// const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));



import HoodSmith from './HoodSelector';
import Tree from 'rtree';

import { growBounds } from './MapHelpers';

const offset = new Offset();

const toRadians = (heading) => heading * (Math.PI / 180);
const flatten = list => list.reduce(
    (a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []
);

class Compass {
  constructor() {
    // Set individual event hook function definitions
    this.EVENTS = [ 'onInitialPosition',
                    'onPositionChange',
                    'onHeadingSupported',
                    'onHeadingChange',
                    'onCompassReady',
                    'onInitialHoods',
                    'onEntitiesDetected',
                    'onHoodChange',
                  ];
    this.EVENTS.forEach(event => {
      this['_'+event] = () => {};
      this[event] = (func) => {
        this['_'+event] = (typeof func === 'function') ?
          func : () => {};
      }
    });
    this.entities = {};
    this._currentPosition = null;
    this._heading = null;
    this._debugStreets = this.getDebugStreets();

    /* DEBUG STREET TEST */
    this._streetsTree = new Tree();
    this._streetsTree.geoJSON(this._debugStreets);

    this._debugHoods = this.getDebugHoods();
    // Delegate hood changes to HoodSmith
    HoodSmith.onHoodChange((hoodData) => {
      // Note: only using Object.assign here to carry over legacy LatLngs, but means they won't actually update on move
      // (Definitely not going to bother calling mapifyHoods here)
      // ToDo: replace newHood with currentHood in all onHoodChange refs, make sure its param is called hoodData and not just data
      const currentHood = hoodData.newHood;
      const { adjacentHoods } = hoodData;
      if (this._hoodData) {
        this._hoodData = Object.assign(this._hoodData, { currentHood, adjacentHoods });
      } else {
        this._hoodData = { currentHood, adjacentHoods }
      }
      // Create a hoods RTree for faster collisions lookup;
      // NOTE: this should be the HoodSmith's responsibility! TESTING ONLY!
      this._hoodsTree = new Tree()
      this._hoodsTree.geoJSON(adjacentHoods);

      this._onHoodChange(hoodData);
    });
  }
  getDebugHoods() {
    return FixtureApi.getNeighborhoodBoundaries('San Francisco').data;
  }
  getDebugStreets() {
    return FixtureApi.getStreets('Tenderloin').data;
  }

  _setEvents(opts) {
    const nullifyOnInactive = (func) => (...args) => this._active ? func(...args) : (() => {})();
    // calling whatever(args); needs to be func(args) if active, noop() otherwise
    this.EVENTS.forEach(event => {
      if (typeof opts[event] === 'function') {
        this['_'+event] = nullifyOnInactive(opts[event]);
      }
    });
  }
  start(opts) {
    /* Backlog:
       - Move to async/await, make all the logic consistent
          -- Start with detection, then features update code
       - Change ALL forEach's into for-of loops for speed
       Icebox:
          - Perhaps start() should be thenable and onInitialPosition
              and onHeadingSupported deprecated.
       Notes:
       - Right now, presumes that no movement is happening on init
          -- To fix this, could use Promise.race with getCurrent and watchPosition
       - ALL instance variable are now set here, not secretly in methods
          -- This is so they can be refactored elsewhere as needed
    */
    var startTime;
    this._active = true;

    this._radius = opts.radius || 10;
    this._setEvents(opts);

    this.getInitialPosition()
      .then(position => {
        if (!this._currentPosition) {
          this._currentPosition = position.coords;
          HoodSmith.refresh(this._currentPosition);
        }
        console.log("1. GOT INITIAL POSITION");
        this._onInitialPosition(position); // probably should pass position.coords
        console.log("1.5 RAN ONINITIALPOSITION");
        this.__frameCounter = 0;
        startTime = Date.now();
        return this._processNeighborhoods(position);
      })
      .then(hoodData => {
        console.tron.log('SPEED: ' + (Date.now()-startTime).toString()+'ms SPREAD: ' + this.__frameCounter.toString()+' frames');
        this._hoodData = hoodData;
        this._hoodsTree = new Tree()
        this._hoodsTree.geoJSON(hoodData.adjacentHoods);
        this._onInitialHoods(hoodData);
      });

    this.watchID = navigator.geolocation.watchPosition(position => {
      this._currentPosition = position.coords;
      HoodSmith.refresh(this._currentPosition);
      console.log("2. GOT POSITION CHANGE");
      this._onPositionChange(position); // probably should pass position.coords
      console.log("2.5. RAN ONPOSITIONCHANGE");

      // ToDo: this allows heading-stationary entity updates, but there's something in the logic that causes it to lag, crash, and suck; fix
      // Idea: maybe tag-team with headingUpdated, such that it is never called once for subsequent events?
      const compassLine = this._compassLine = this.getCompassLine(); // also carried over from headingChange
      // if (!compassLine || !this._hoodData || this._detectionPending || !this._lastHeading) return; // important debouncer and flow checks
      // this._detectionPending = true;
      // this._detectEntities(this._lastHeading).then(entities => {
      //   this._entities = entities;
      //   this._onEntitiesDetected(entities);
      //   this._detectionPending = false;
      //   // console.tron.log('SPEED: ' + (Date.now()-startTime).toString()+'ms SPREAD: ' + this.__frameCounter.toString()+' frames');
      // });
    });

    ReactNativeHeading.start(opts.minAngle || 1)
    .then(didStart => this._onHeadingSupported(didStart));

    var totalSpeed = 0;
    var trials = 0;
    DeviceEventEmitter.addListener('headingUpdated', data => {
      const heading = this._heading = data.heading;
      const compassLine = this._compassLine = this.getCompassLine();
      // Note: just as here, it might be best to eventually forward both position and heading to all Compass
      //lifecycle functions
      this._onHeadingChange({ heading, compassLine, position: this._currentPosition });
      // if (this._detectionPending) {
      //   console.tron.log("EMITTER SEES PENDING")
      // }
      if (!compassLine || !this._hoodData || this._detectionPending) return;
      this._splitBoxes = this.__getCompassLineBounds();

      // MEASURE 1: angle/timing kludge for feature detection
      // if (this._lastHeadingChange && Date.now()-this._lastHeadingChange < 1000) return;
      // if (this._lastHeading && Math.abs(heading-this._lastHeading) < 5) return;
      // END
      const startTime = Date.now();
      this.__frameCounter = 0;
      this._detectionPending = true;
      this._detectEntities(heading).then(entities => {
        this._entities = entities;
        this._onEntitiesDetected(entities);
        this._detectionPending = false;
        trials++;
        totalSpeed = (totalSpeed+Date.now()-startTime);
        let avgSpeed = (totalSpeed/trials).toFixed(0);
        console.tron.log('AVG: ' + avgSpeed+'ms SPREAD: ' + this.__frameCounter.toString()+' frames');
      });
      this._lastHeadingChange = Date.now();
      this._lastHeading = heading;
    });
  }

  getInitialPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position),
        (error) => reject('Location timed out')
      );
    });
  }

  getCompassLine(heading = this._heading,
                 radius = this._radius,
                 origin = this._currentPosition) {
    if (!origin) return null;
    const headingInRadians = toRadians(heading);
    return [origin, {
        longitude: origin.longitude + radius * Math.sin(headingInRadians),
        latitude: origin.latitude + radius * Math.cos(headingInRadians)
      }];
  }

  async _detectEntities(heading) {
    // MEASURE 2: Return cached entities if any _detectEntities frame has not run to completion
    // if (this._detectionPending) {
    //   console.tron.log("SENDING CACHED ENTITIES");
    //   return this._entities;
    // }
    // END
    console.tron.log('---');
    await nextFrame(); this.__frameCounter++;
    const hoods = await this.getHoodCollisionsFastester();
    await nextFrame(); this.__frameCounter++;
    const streets = await this.getStreetCollisionsFastester();
    // await nextFrame(); this.__frameCounter++;
    // const otherStreets = await this.getStreetCollisionsFaster();
    // if (streets.length !== otherStreets.length) {
    //   let big, small;
    //   console.tron.log("!!!!!!DIFFERENCE!!!! ");
    //   if (streets > otherStreets) {
    //     big = streets;
    //     small = otherStreets;
    //   } else {
    //     big = otherStreets;
    //     small = streets;
    //   }
    //   // console.tron.log('BIG: ' + JSON.stringify(big));
    //   // console.tron.log('SMALL: ' + JSON.stringify(small));
    //   let smallNames = small.map(street => street.name);
    //   let bigNames  = big.map(street => street.name);
    //   console.tron.log(JSON.stringify(bigNames.filter(name => smallNames.indexOf(name) < 0)));
    // }


    return { hoods, streets };
  }

  _getCompassLineFeature() {
    return lineString(toTuples(this._compassLine));
  }

  // Another dumb debug function for visualizing compass bounds
  // This will eventually be more than a debug function and do all the work of
  //  selecting a subset of split bboxes to use with rtree street lookups
  // Probably breaks some conventions, *shrug*
  __getCompassLineBounds() {
    var lineBox = turf.bbox(this._getCompassLineFeature());
    lineBox = [lineBox.slice(0,2), lineBox.slice(2)];

    const heading = this._heading;
    // calculate quadrants from 0 to 3 from angle
    var quadrant = Math.floor(heading/90);
    var splitBox = splitBBox(lineBox);
    // This is what goes in our recursive function, by the way:
    splitBox = splitBox.reduce((result, bounds) => result.concat(splitBBox(bounds)),[]);

    // select the correct diagonal based on the quadrant... just kludging it out for now
    const diagonal = [[0,3,12,15], [5,6,9,10]][quadrant%2];
    if (quadrant === 1 || quadrant === 2) diagonal.reverse();
    return diagonal.map(index => splitBox[index]);
    // Grow bounding box to eliminate false negatives
    // return diagonal.map((index, i) => (i < diagonal.length-1 && i > 0) ? growBounds(splitBox[index]) : splitBox[index] );
  }

  async getHoodCollisionsFastester(compassLineFeature = this._getCompassLineFeature(),
                    adjacentHoods = this._hoodData.adjacentHoods,
                    currentHood = this._hoodData.currentHood,
                    hoodsTree = this._hoodsTree) {
    var adjacents = [];
    var splitBoxes = this._splitBoxes;

    let hoodStore = {};
    let compassCoords = compassLineFeature.geometry.coordinates;

    // Note: this eschews candidateHoods; might want to
    // still push hoods out later for something
    for (let splitBox of splitBoxes) {
      for (let hood of hoodsTree.bbox(splitBox)) {
        if (hoodStore[hood.properties['id']]) continue;
        hoodStore[hood.properties['id']] = true;
        const { coordinates, type } = hood.geometry;
        const collision = (type === 'MultiPolygon') ?  
          multiPolyIntersect(compassCoords, coordinates) :
          polyIntersect(compassCoords, coordinates[0]);
        if (!collision) continue;
        // WARNING: debug only! This is only here to render a line temporarily
        this.__lastCollisionPoint = collision.collision;
        const collisionDistance = collision.distance;
        adjacents.push({
          name: hood.properties.label,
          distance: collisionDistance.toFixed(2) + ' miles',
        });
      };
      if (adjacents.length) break;
    }
    console.tron.log('ADJACENTS: '+adjacents.length);
    const current = {
      name: currentHood.properties.label,
      coordinates: currentHood.geometry.coordinates,
      feature: currentHood,
    }
    return {adjacents, current };
  }

  async getHoodCollisionsFastest(compassLineFeature = this._getCompassLineFeature(),
                    adjacentHoods = this._hoodData.adjacentHoods,
                    currentHood = this._hoodData.currentHood,
                    hoodsTree = this._hoodsTree) {
    var adjacents = [];
    var startHeading = this._heading;

    var lineBox = turf.bbox(compassLineFeature);
    lineBox = [lineBox.slice(0,2), lineBox.slice(2)];

    var candidateHoods = hoodsTree.bbox(lineBox);

    console.tron.log('ADJACENTS: '+candidateHoods.length);
    
    let compassCoords = compassLineFeature.geometry.coordinates;
    for (let feature of candidateHoods) {
      let featureCoords = feature.geometry.coordinates;
      let type = feature.geometry.type;

      if (currentHood.properties.label === feature.properties.label) continue;
      const collision = (type === 'MultiPolygon') ?  
        multiPolyIntersect(compassCoords, featureCoords) :
        polyIntersect(compassCoords, featureCoords[0]);
      // console.tron.log('????'+JSON.stringify(collision));
      // await nextFrame(); this.__frameCounter++;
      if (!collision) continue;
      // WARNING: debug only! This is only here to render a line temporarily
      this.__lastCollisionPoint = collision.collision;
      const collisionDistance = collision.distance;

      adjacents.push({
        name: feature.properties.label,
        distance: collisionDistance.toFixed(2) + ' miles',
        // coordinates: feature.geometry.coordinates,
        // feature,
      });
    }
    const current = {
      name: currentHood.properties.label,
      coordinates: currentHood.geometry.coordinates,
      feature: currentHood,
    }
    return {adjacents, current };
  }

  async getHoodCollisionsFaster(compassLineFeature = this._getCompassLineFeature(),
                    adjacentHoods = this._hoodData.adjacentHoods,
                    currentHood = this._hoodData.currentHood,
                    hoodsTree = this._hoodsTree) {
    var adjacents = [];
    var startHeading = this._heading;

    var lineBox = turf.bbox(compassLineFeature);
    lineBox = [lineBox.slice(0,2), lineBox.slice(2)];

    var candidateHoods = hoodsTree.bbox(lineBox);

    // console.tron.log('ADJACENTS: '+candidateHoods.length);
    
    for (let feature of candidateHoods) {
      await nextFrame(); this.__frameCounter++;
      const collisions = intersect(compassLineFeature, feature);
      if (!collisions ||
        currentHood.properties.label === feature.properties.label) continue;
      const type = collisions.geometry.type;
      const coords = collisions.geometry.coordinates;
      const nearestCoord = (type === 'MultiLineString') ? coords[0][0] : coords[0];
      const nearestFeature = point(nearestCoord);
      const originFeature = point(compassLineFeature.geometry.coordinates[0]);
      const collisionDistance = turf.distance(originFeature, nearestFeature, 'miles');
      this.__lastCollisionPoint = nearestCoord;
      adjacents.push({
        name: feature.properties.label,
        distance: collisionDistance.toFixed(2) + ' miles',
        // coordinates: feature.geometry.coordinates,
        // feature,
      });
    }
    const current = {
      name: currentHood.properties.label,
      coordinates: currentHood.geometry.coordinates,
      feature: currentHood,
    }
    return {adjacents, current };
  }


  // Probably just wrap this in a requestAnimationFrame for now
  async getHoodCollisions(compassLineFeature = this._getCompassLineFeature(),
                    adjacentHoods = this._hoodData.adjacentHoods,
                    currentHood = this._hoodData.currentHood) {
    var adjacents = [];
    var startHeading = this._heading;
    console.tron.log('ADJACENTS: '+adjacentHoods.length);

    for (let feature of adjacentHoods) {
      await nextFrame(); this.__frameCounter++;
      const collisions = intersect(compassLineFeature, feature);
      if (!collisions ||
        currentHood.properties.label === feature.properties.label) continue;
      const type = collisions.geometry.type;
      const coords = collisions.geometry.coordinates;
      const nearestCoord = (type === 'MultiLineString') ? coords[0][0] : coords[0];
      const nearestFeature = point(nearestCoord);
      const originFeature = point(compassLineFeature.geometry.coordinates[0]);
      const collisionDistance = turf.distance(originFeature, nearestFeature, 'miles');
      adjacents.push({
        name: feature.properties.label,
        distance: collisionDistance.toFixed(2) + ' miles',
        // coordinates: feature.geometry.coordinates,
        // feature,
      });
    }
    const current = {
      name: currentHood.properties.label,
      coordinates: currentHood.geometry.coordinates,
      feature: currentHood,
    }
    return {adjacents, current };
  }
  async getStreetCollisionsFastester(
                      maxStreets = 4,
                      compassLineFeature = this._getCompassLineFeature(),
                      streetsFixture = this._debugStreets, 
                      streetsTree =  this._streetsTree ) {
    // return ['Streets Stubbed'];
    var streetsAhead = [];
    var startTime, endTime, timeDiff;
    var topStartTime = Date.now();

    var splitBoxes = this._splitBoxes;
    let candidateStreets = [];
    let streetStore = {};
    let compassCoords = compassLineFeature.geometry.coordinates;
    for (let splitBox of splitBoxes) {
      for (let street of streetsTree.bbox(splitBox)) {
        if (streetStore[street.properties['@id']]) continue;
        // await nextFrame; this.__frameCounter++;
        const { coordinates } = street.geometry;
        const collision = polyIntersect(compassCoords, coordinates);
        if (!collision) continue;
        // Note: only run a successful collision once
        streetStore[street.properties['@id']] = true;
        const streetData = {
          name: street.properties.name,
          distance: collision.distance.toFixed(2) + ' miles',
          angle: getAngle(compassCoords,collision.segment).toFixed(1)
        };
        const relations = street.properties['@relations'];
        if (relations) {
          let routes = {};
          for (let relation of relations) {
            // await nextFrame(); this.__frameCounter++;
            const { type, ref } = relation.reltags;
            if (type === "route") routes[ref] = true;
          };
          if (routes) streetData.routes = Object.keys(routes);
        }
        streetsAhead.push(streetData);
        if (streetsAhead.length >= maxStreets) {
          // Yuck, stop toFixing the distance 
          return streetsAhead.sort((a,b) => parseFloat(a.distance)-parseFloat(b.distance));
        }
      }
    }
    return streetsAhead;
  }

  async getStreetCollisionsFastest(compassLineFeature = this._getCompassLineFeature(),
                      streetsFixture = this._debugStreets, 
                      streetsTree =  this._streetsTree ) {
    // return ['Streets Stubbed'];
    var streetsAhead = [];
    var startTime, endTime, timeDiff;
    var topStartTime = Date.now();

    var splitBoxes = this._splitBoxes;
    let candidateStreets = [];
    let streetStore = {};
    for (let splitBox of splitBoxes) {
      // let newFoundStreets = [];
      // streetsTree.bbox(splitBox).forEach(street => {
      //   if (streetStore[street.properties['@id']]) return;
      //   streetStore[street.properties['@id']] = true;
      //   newFoundStreets.push(street);
      // });
      // candidateStreets = candidateStreets.concat(newFoundStreets);
      candidateStreets = candidateStreets.concat(streetsTree.bbox(splitBox));
      // await nextFrame; this.__frameCounter++;
    }

    // console.tron.log('STORE: ' + Object.keys(streetStore).length);
    // console.tron.log('CANDIDATES: ' + candidateStreets.length);

    const originFeature = point(compassLineFeature.geometry.coordinates[0]);

    let compassCoords = compassLineFeature.geometry.coordinates;
    for (let feature of candidateStreets) {
      if (streetStore[feature.properties['@id']]) continue;
      // await nextFrame; this.__frameCounter++;
      // console.tron.log(JSON.stringify(feature.properties.name));

      let featureCoords = feature.geometry.coordinates;

      let collision = polyIntersect(compassCoords, featureCoords);
      if (!collision) continue;
      // Note: only run a successful collision once
      streetStore[feature.properties['@id']] = true;
      const collisionDistance = collision.distance;
      console.log(feature.properties.name +': '+ JSON.stringify(compassCoords) + ' !!! '+JSON.stringify(collision.segment));
      const street = {
        name: feature.properties.name,
        distance: collisionDistance.toFixed(2) + ' miles',
        angle: getAngle(compassCoords,collision.segment).toFixed(1)
      };
      const relations = feature.properties['@relations'];
      if (relations) {
        let routes = {};
        for (let relation of relations) {
          // await nextFrame(); this.__frameCounter++;
          if (relation.reltags.type === "route") {
            routes[relation.reltags.ref] = true;
          }
        };
        if (routes) street.routes = Object.keys(routes);
      }
      streetsAhead.push(street);
    }
    // console.tron.log("FASTEST: "+ streetsAhead.length);
    return streetsAhead;
  }

  async getStreetCollisionsFasterer(compassLineFeature = this._getCompassLineFeature(),
                      streetsFixture = this._debugStreets, 
                      streetsTree =  this._streetsTree ) {
    // return ['Streets Stubbed'];
    var streetsAhead = [];
    var startTime, endTime, timeDiff;
    var topStartTime = Date.now();

    var splitBoxes = this.__getCompassLineBounds();
    let candidateStreets = [];
    let streetStore = {};
    for (let splitBox of splitBoxes) {
      // let newFoundStreets = [];
      // streetsTree.bbox(splitBox).forEach(street => {
      //   if (streetStore[street.properties['@id']]) return;
      //   streetStore[street.properties['@id']] = true;
      //   newFoundStreets.push(street);
      // });
      // candidateStreets = candidateStreets.concat(newFoundStreets);
      candidateStreets = candidateStreets.concat(streetsTree.bbox(splitBox));
    }

    console.tron.log('STORE: ' + Object.keys(streetStore).length);
    console.tron.log('CANDIDATES: ' + candidateStreets.length);

    const originFeature = point(compassLineFeature.geometry.coordinates[0]);

    for (let feature of candidateStreets) {
      // await nextFrame; this.__frameCounter++;
      // console.tron.log(JSON.stringify(feature.properties.name));
      let collision = intersect(compassLineFeature, feature);

      // console.tron.log("-STREETS- intersect: "+(Date.now()-topStartTime).toString()+'ms');
      if (!collision) continue;
      // NOTE: only run a successful collision once
      if (streetStore[feature.properties['@id']]) continue;
      streetStore[feature.properties['@id']] = true;

      //  NOTE: adding try-catches to all these asyncs might be a GOOD IDEA
      // This fixes MultiLine collisions to work with turf.distance:
      if (collision.geometry.type === 'MultiPoint') {
        Object.assign(collision.geometry, {
          type: 'Point',
          coordinates: collision.geometry.coordinates[0]
        });
      }
      // console.log('HERE: '+JSON.stringify(collision));
      const collisionDistance = turf.distance(originFeature,collision);

      const street = {
        name: feature.properties.name,
        distance: collisionDistance.toFixed(2) + 'miles'
      };
      const relations = feature.properties['@relations'];
      if (relations) {
        let routes = {};
        for (let relation of relations) {
          // await nextFrame(); this.__frameCounter++;
          if (relation.reltags.type === "route") {
            routes[relation.reltags.ref] = true;
          }
        };
        if (routes) street.routes = Object.keys(routes);
      }
      streetsAhead.push(street);
    }
    console.tron.log("FASTERER: "+ streetsAhead.length);
    return streetsAhead;
  }

  async getStreetCollisionsFaster(compassLineFeature = this._getCompassLineFeature(),
                      streetsFixture = this._debugStreets, 
                      streetsTree =  this._streetsTree ) {
    // return ['Streets Stubbed'];
    var streetsAhead = [];
    const startHeading = this._heading;
    var startTime, endTime, timeDiff;
    var topStartTime = Date.now();

    var lineBox = turf.bbox(compassLineFeature);
    lineBox = [lineBox.slice(0,2), lineBox.slice(2)];

    // area = Math.abs(lineBox[0][0]-lineBox[1][0])*Math.abs(lineBox[0][1]-lineBox[1][1]);
    // console.tron.log('COMPASS: '+area);

    var candidateStreets = streetsTree.bbox(lineBox);
    // console.tron.log('CANDIDATES 1: '+candidateStreets.length);

    const originFeature = point(compassLineFeature.geometry.coordinates[0]);
    for (let feature of candidateStreets) {
      // await nextFrame; this.__frameCounter++;
      let collision = intersect(compassLineFeature, feature);
      // console.tron.log("-STREETS- intersect: "+(Date.now()-topStartTime).toString()+'ms');
      if (!collision) continue;
      //  NOTE: adding try-catches to all these asyncs might be a GOOD IDEA
      // This fixes MultiLine collisions to work with turf.distance:
      if (collision.geometry.type === 'MultiPoint') {
        Object.assign(collision.geometry, {
          type: 'Point',
          coordinates: collision.geometry.coordinates[0]
        }); 
      }
      const collisionDistance = turf.distance(originFeature,collision);
      const street = {
        name: feature.properties.name,
        distance: collisionDistance.toFixed(2) + 'miles'
      };
      const relations = feature.properties['@relations'];
      if (relations) {
        let routes = {};
        for (let relation of relations) {
          // await nextFrame(); this.__frameCounter++;
          if (relation.reltags.type === "route") {
            routes[relation.reltags.ref] = true;
          }
        };
        if (routes) street.routes = Object.keys(routes);
      }
      streetsAhead.push(street);
    }
    console.tron.log("FASTER:   "+ streetsAhead.length);
    return streetsAhead;
  }

  async getStreetCollisions(compassLineFeature = this._getCompassLineFeature(),
                      streetsFixture = this._debugStreets ) {
    // return ['Streets Stubbed'];
    var streetsAhead = [];
    const startHeading = this._heading;
    var startTime, endTime, timeDiff;
    var topStartTime = Date.now();
    // MEASURE 3: replace forEach with let and call nextFrame several on each iteration
    for (let feature of streetsFixture) {
      await nextFrame; this.__frameCounter++;
      const collision = intersect(compassLineFeature, feature);
      // console.tron.log("-STREETS- intersect: "+(Date.now()-topStartTime).toString()+'ms');
      if (!collision) continue;
      const originFeature = point(compassLineFeature.geometry.coordinates[0]);
      const collisionDistance = turf.distance(originFeature,collision);
      const street = {
        name: feature.properties.name,
        distance: collisionDistance.toFixed(2) + 'miles'
      };
      const relations = feature.properties['@relations'];
      if (relations) {
        let routes = {};
        for (let relation of relations) {
          await nextFrame(); this.__frameCounter++;
          if (relation.reltags.type === "route") {
            routes[relation.reltags.ref] = true;
          }
        };
        if (routes) street.routes = Object.keys(routes);
      }
      streetsAhead.push(street);
    }
    return streetsAhead;
  }

  async _processNeighborhoods(position) {
    let startTime = Date.now();
    const adjacentHoods = HoodSmith.getAdjacentHoods();
    const currentHood = HoodSmith.getCurrentHood();
    // const rawHoods = this._debugHoods;
    // await nextFrame(); this.__frameCounter++;
    // console.tron.log('getDebugHoods: ' + (Date.now()-startTime).toString()+'ms frames: ' + this.__frameCounter.toString());
    const streets = this._debugStreets;
    await nextFrame(); this.__frameCounter++;
    // const currentHood = await this._findCurrentHood(position, rawHoods.features);
    // await nextFrame(); this.__frameCounter++;
    // console.tron.log('findCurrentHood: ' + (Date.now()-startTime).toString()+'ms frames: ' + this.__frameCounter.toString())
    // const adjacentHoods = await this._findAdjacentHoods(currentHood, rawHoods.features);
    // await nextFrame(); this.__frameCounter++;
    // console.tron.log('findAdjacentHoods: ' + (Date.now()-startTime).toString()+'ms frames: ' + this.__frameCounter.toString())
    const hoodLatLngs = this.mapifyHoods(adjacentHoods);
    await nextFrame(); this.__frameCounter++;
    console.tron.log('mapifyHoods: ' + (Date.now()-startTime).toString()+'ms frames: ' + this.__frameCounter.toString())
    const streetLatLngs = this.mapifyStreets(streets);
    await nextFrame(); this.__frameCounter++;
    console.tron.log('mapifyStreets: ' + (Date.now()-startTime).toString()+'ms frames: ' + this.__frameCounter.toString())
    const hoodData = { currentHood, adjacentHoods, hoodLatLngs, streetLatLngs, streets };
    return hoodData;
  }

  async _findCurrentHood(position, hoodFeatures) {
    for (let feature of hoodFeatures) {
      const curPosGeo = point(toTuple(position.coords)).geometry;
      if (inside(curPosGeo, feature)) return feature;
      await nextFrame(); this.__frameCounter++;
    }
  }

  async _findAdjacentHoods(currentHood, hoodFeatures) {
    // This does an in-place grow on currentHood in order to find intersections
    // Not doing this can sometimes turn up false negatives when polys
    // don't fully overlap.
    // Note: Not yet working with MultiPolys.
    const bloatedHood = this.bloatAndSimplify(currentHood);
    var adjacentHoods = [];
    for (feature of hoodFeatures) {
      if (currentHood === feature) continue;
      if (intersect(bloatedHood, feature)) {
        feature = clone(feature);
        // Simplifies with the D3-derived Visvalingam algorithm:
        // (Clone first to avoid changing source data)
        let pointCount = flatten(feature.geometry.coordinates).length/2;
        feature.geometry.coordinates[0] = vis(feature.geometry.coordinates[0],pointCount*0.5);
        adjacentHoods.push(feature);
        await nextFrame(); this.__frameCounter++;
      }
    }
    return adjacentHoods;
  }

  stop() {
    this._active = false;
    ReactNativeHeading.stop();
    DeviceEventEmitter.removeAllListeners('headingUpdated');
    navigator.geolocation.clearWatch(this.watchID);
  }

  //TODO: make sure this works for MultiPolys!
  // If it doesn't, it's possible that false negatives will break LESS often
  // Than failed bloatAndSimplify operations
  bloatAndSimplify(feature) {
    // Deep clone the input to keep the function pure
    feature =  clone(feature);
    const coords = feature.geometry.coordinates;
    feature.geometry.coordinates = offset.data(coords).margin(0.0003); //offset the polygon
    feature.geometry = turf.simplify(feature,0.00005,false).geometry;  //simplify the offset poly
    return feature;
  }

  mapifyStreets(features) {
    return features.map((feature) => {
      const coordSet = feature.geometry.coordinates;
      const latLngs = coordSet.map((coords) => ({
        longitude: coords[0],
        latitude: coords[1]
      }));
      return {
        name: feature.properties.name,
        coords: latLngs
      };
    });
  }

  mapifyHoods(features) {
    return features.reduce((hoods, feature) => {
      // Check for polyline vs. non-polyline
      // If multiline, map each and add extra square braces
      const shapeType = feature.geometry.type;
      const hoodName = feature.properties.label;
      if (shapeType === 'Polygon') {
        const coordSet = feature.geometry.coordinates[0];
        const latLngs = coordSet.map((coords) => ({
          longitude: coords[0],
          latitude: coords[1]
        }));
        hoods.push({ name: hoodName, coords: latLngs});
      } else if (shapeType === 'MultiPolygon') {
        const multiCoordSet = feature.geometry.coordinates;
        multiCoordSet.forEach(coordSet => {
          // MultiPolygon adds an extra layer of depth, so get rid of it
          coordSet = coordSet[0];
          const latLngs = coordSet.map((coords) => ({
            longitude: coords[0],
            latitude: coords[1]
          }));
          hoods.push({ name: hoodName, coords: latLngs});
        });
      }
      return hoods;
    },[]);
  }
}

const compass = new Compass();

// Can't freeze this because the object overwrites its own methods
// at runtime; probably won't matter:
// Object.freeze(compass);

export default compass;

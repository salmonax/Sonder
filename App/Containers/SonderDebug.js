'use strict';
/* eslint no-console: 0 */
import React, { Component } from 'react';
import { connect } from 'react-redux';
import Mapbox, { MapView } from 'react-native-mapbox-gl';
import {
  StyleSheet,
  Text,
  StatusBar,
  View,
  ScrollView,
  Dimensions,
} from 'react-native';

import Styles from './Styles/MapViewStyle';
import Compass from '../Lib/Compass';
import { 
  hoodToAnnotations, 
  reverseTuples, 
  getPrettyBearing, 
  toTuples,
  binduMapBox,
} from '../Lib/MapHelpers';
import Svg, {
  Circle, 
  Line,
} from 'react-native-svg';
import Orientation from 'react-native-orientation';

let { width, height } = Dimensions.get('window');
let centerY = Math.round(height/2);
let centerX = Math.round(width/2);
console.tron.log(JSON.stringify({ width, height, centerX, centerY }));

const accessToken = 'pk.eyJ1Ijoic2FsbW9uYXgiLCJhIjoiY2l4czY4dWVrMGFpeTJxbm5vZnNybnRrNyJ9.MUj42m1fjS1vXHFhA_OK_w';
Mapbox.setAccessToken(accessToken);

const hoods = Compass.getDebugHoods();

class SonderView extends Component {
  currentHoodColor = '#AA9922';
  state = {
    zoom: 12,
    userTrackingMode: Mapbox.userTrackingMode.follow,
    annotations: []
  };

  onRegionDidChange = (location) => {
    this.setState({ currentZoom: location.zoomLevel });
    console.log('onRegionDidChange', location);
  };
  onRegionWillChange = (location) => {
    console.log('onRegionWillChange', location);
  };
  onUpdateUserLocation = (location) => {
    console.log('onUpdateUserLocation', location);
  };
  onOpenAnnotation = (annotation) => {
    console.log('onOpenAnnotation', annotation);
  };
  onRightAnnotationTapped = (e) => {
    console.log('onRightAnnotationTapped', e);
  };
  onLongPress = (location) => {
    console.log('onLongPress', location);
  };
  onTap = (location) => {
    console.log('onTap', location);
  };
  onChangeUserTrackingMode = (userTrackingMode) => {
    this.setState({ userTrackingMode });
    console.log('onChangeUserTrackingMode', userTrackingMode);
  };

  componentWillMount() {
    Compass.start({
      minAngle: 1,
      radius: 10,
      onInitialPosition: (initialPosition) => {
        this.setState({ initialPosition })
      },
      onInitialHoods: ({ currentHood, adjacentHoods, hoodLatLngs, streetLatLngs}) => {
        this.setState({ 
          currentHood, 
          adjacentHoods, 
          hoods: hoodLatLngs,
          streets: streetLatLngs
        });
        this.setHoodAnnotations(currentHood, adjacentHoods);
      },
      onHeadingSupported: (headingIsSupported) => 
        this.setState({ headingIsSupported }),
      onPositionChange: (lastPosition) => {
        // console.tron.log("POSITION CHANGED: " + JSON.stringify(lastPosition.coords));
        const { latitude, longitude } = lastPosition.coords;
        const ops = { latitude, longitude };
        if (this._lastHeading) { ops.direction = this._lastHeading }
        if (this._map) {
          this._map.easeTo(ops, true, () => {});
        }
        this.setState({ lastPosition })
      },
      onHoodChange: ({newHood, adjacentHoods}) => {
        this.setState({ currentHood: newHood, adjacentHoods });
        console.tron.log('HOOD CHANGED '+adjacentHoods.length.toFixed());;
        this.setHoodAnnotations(newHood, adjacentHoods);
      },
      onHeadingChange: (headingData) => {
        this.setState({ heading: headingData.heading });
        this._lastHeading = headingData.heading;
        const direction = headingData.heading;    
        if (headingData.position) {
          const { latitude, longitude } = headingData.position;
          this._map.easeTo({ direction, latitude, longitude }, true, () => {});
        } else {
          console.tron.log('Position is missing! Mario is missing! Where is Carmen San Diego?!');
          this._map.setDirection(headingData.heading);
        }
        // this.setCompassAnnotation(headingData);
      },
      onEntitiesDetected: (entities) => 
        this.setState({ entities })
    });
  }

  componentDidMount() {
    Orientation.addOrientationListener(this._orientationDidChange);
  }

  componentWillUnmount() {
    Compass.stop();
  }

  setHoodAnnotations(currentHood, adjacentHoods) {
    // Draw the hood annotation, with random color, then with BinduRGB
    const currentHoodAnnotations = hoodToAnnotations(currentHood, {
      id: currentHood.properties.label,
      // fillAlpha: 0.5,
      // alpha: 0.5,
      class: 'hood',
      fillColor: '#AA9922',
      strokeColor: '#FFFFFF',
      strokeWidth: 10,
      // strokeAlpha: .5,
    });
    // alert(JSON.stringify(currentHoodAnnotations));
    const adjacentHoodAnnotations = [];
    for (let adjacentHood of adjacentHoods) {
      const annotations = hoodToAnnotations(adjacentHood, {
        id: adjacentHood.properties.label,
        // fillAlpha: 0.5,
        // alpha: 0.5,
        class: 'hood',
        fillColor: binduMapBox(adjacentHood.properties.label),
        strokeColor: '#FFFFFF',
        strokeWidth: 10,
        // strokeAlpha: .5,
      });
      adjacentHoodAnnotations.push(...annotations);
    }

    this.setState({
      annotations: [
        ...this.state.annotations.filter(annotation => annotation.class !== 'hood'), 
        ...currentHoodAnnotations,
        ...adjacentHoodAnnotations,
      ]
    }) 
    // Draw the adjacenthood annotations, with random color, then with BinduRGB
  }
  
  _orientationDidChange(orientation) {
    // Listener seems to fire too early for Dimensions.get() to work
    // Just switch hte previous values:
    const lastWidth = width;
    width = height;
    height = lastWidth;
    centerY = Math.round(height/2);
    centerX = Math.round(width/2);
    console.tron.log(orientation);
    console.tron.log(JSON.stringify({ width, height, centerX, centerY }));
  }

  setCompassAnnotation(headingData) {
    let compassTuple = toTuples(headingData.compassLine);
    compassTuple = [compassTuple[0].reverse(), compassTuple[1].reverse()]
    if (!this.state.annotations.length) {
      this.setState({
        heading: headingData.heading,
        annotations: [{
          id: 'compassLine',
          coordinates: compassTuple,
          type: 'polyline',
          strokeColor: '#FF0000',
          strokeWidth: 1,
          strokeAlpha: .5
        }]
      });
      // alert(JSON.stringify(this.state.annotations))
    } else {
      this.setState({
        heading: headingData.heading,
        annotations: this.state.annotations.map(annotation => 
          (annotation.id !== 'compassLine') ? 
            annotation :
            Object.assign({},annotation,{ coordinates: compassTuple })
        )
      });
    }
  }

  render() {
    StatusBar.setHidden(true);
    const nearestAdjacentHood = (this.state.entities) ? 
      this.state.entities.hoods.adjacents.sort((a,b) => {
        return (parseFloat(a.distance) - parseFloat(b.distance));
      })[0] : 
      '';
    const dynamicStyles = StyleSheet.create({
      currentHood: {
        position: 'absolute',
        paddingLeft: 10,
        paddingRight: 10,
        right: 20,
        bottom: 72,
        fontSize: 32,
        borderColor: '#AA9922',
        borderWidth: 1,
        color: '#AA9922',
        backgroundColor: '#000000'
      },
      adjacentHood: {
        position: 'absolute',
        paddingLeft: 10,
        paddingRight: 10,
        right: 5,
        top: 80,
        fontSize: 20,
        backgroundColor: '#000000',
        color: (nearestAdjacentHood && this.state.entities) ? binduMapBox(nearestAdjacentHood.name) : '#ffffff',
        borderColor: (nearestAdjacentHood && this.state.entities) ? binduMapBox(nearestAdjacentHood.name) : '#ffffff',
        borderWidth: 1
      }
    });
    const nearestAdjacentHoodLabel = (nearestAdjacentHood && this.state.entities) ? nearestAdjacentHood.name +' ('+nearestAdjacentHood.distance+')' : '';
    return (
      <View style={styles.container}>
        <MapView
          ref={map => { this._map = map; }}
          style={styles.map}
          initialCenterCoordinate={this.state.center}
          initialZoomLevel={this.state.zoom}
          initialDirection={0}
          rotateEnabled={true}
          scrollEnabled={true}
          zoomEnabled={true}
          showsUserLocation={false}
          styleURL="mapbox://styles/salmonax/cixz7vidr002f2smnobevrktd"
          userTrackingMode={this.state.userTrackingMode}
          annotations={this.state.annotations}
          annotationsAreImmutable
          onChangeUserTrackingMode={this.onChangeUserTrackingMode}
          onRegionDidChange={this.onRegionDidChange}
          onRegionWillChange={this.onRegionWillChange}
          onOpenAnnotation={this.onOpenAnnotation}
          onRightAnnotationTapped={this.onRightAnnotationTapped}
          onUpdateUserLocation={this.onUpdateUserLocation}
          onLongPress={this.onLongPress}
          onTap={this.onTap}
        />
        <Svg
          style={styles.overlay}
          height={height}
          width={width}
        >
          <Circle
              cx={centerX}
              cy={centerY}
              r="150"
              stroke="white"
              strokeWidth="2"
              strokeOpacity="0.5"
              fillOpacity="0"
          />
          <Line
            x1={centerX}
            x2={centerX}
            y1="0"
            y2={height}
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
          <Line
            y1={centerY}
            y2={centerY}
            x1="0"
            x2={width}
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </Svg>
        <Text>{this.state.headingIsSupported ?
                getPrettyBearing(this.state.heading)
                : "Heading unsupported." }</Text>
        {this.state.entities ? <Text style={dynamicStyles.currentHood}>{this.state.entities ? 
              this.state.entities.hoods.current.name : ''}</Text> : null }
        {this.state.entities ? <Text style={dynamicStyles.adjacentHood}>{nearestAdjacentHoodLabel}</Text> : null }

            {/*<Text>{this.state.entities ? 
              JSON.stringify(this.state.entities.hoods) : 
              "Waiting for entities..."}</Text>
            <Text>{this.state.headingIsSupported ?
                    getPrettyBearing(this.state.heading)
                    : "Heading unsupported." }</Text>
            <Text>{this.state.entities ? 
                    JSON.stringify(this.state.entities.streets) :
                    "Normalizing reticulating splines..."}</Text>
            <Text>{this.state.annotations ? 
                    JSON.stringify( this.state.annotations ) :
                    null
                  }</Text>*/}
      </View>
    );
  }

}

const mapStateToProps = (state) => {
  return {
    // ...redux state to props here
  }
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  currentHood: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    fontSize: 32
  },
  container: {
    flex: 1,
    alignItems: 'stretch'
  },
  map: {
    flex: 1
  },
  scrollView: {
    flex: 1
  }
});

export default connect(mapStateToProps)(SonderView)

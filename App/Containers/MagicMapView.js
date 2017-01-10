import React from 'react'
import { connect } from 'react-redux'
import { View, Text, TouchableOpacity, Animated } from 'react-native'
import MapView from 'react-native-maps'
import { calculateRegion } from '../Lib/MapHelpers'
import MapCallout from '../Components/MapCallout'
import Styles from './Styles/MapViewStyle'
import { getRegionBBox, toCoords, toTuples, toTuple } from '../Lib/MapHelpers';

/* ***********************************************************
* IMPORTANT!!! Before you get started, if you are going to support Android,
* PLEASE generate your own API key and add it to android/app/src/main/AndroidManifest.xml
* We've included our API key for demonstration purposes only, and it will be regenerated from
* time to time. As such, neglecting to complete this step could potentially break your app in production!
* https://console.developers.google.com/apis/credentials
* Also, you'll need to enable Google Maps Android API for your project:
* https://console.developers.google.com/apis/api/maps_android_backend/
*************************************************************/

class MapViewExample extends React.Component {
  /* ***********************************************************
  * This example is only intended to get you started with the basics.
  * There are TONS of options available from traffic to buildings to indoors to compass and more!
  * For full documentation, see https://github.com/lelandrichardson/react-native-maps
  *************************************************************/

  constructor (props) {
    super(props)
    /* ***********************************************************
    * STEP 1
    * Set the array of locations to be displayed on your map. You'll need to define at least
    * a latitude and longitude as well as any additional information you wish to display.
    *************************************************************/
    const locations = [
      { title: 'Location A', latitude: 37.78825, longitude: -122.4324 },
      { title: 'Location B', latitude: 37.75825, longitude: -122.4624 }
    ]
    /* ***********************************************************
    * STEP 2
    * Set your initial region either by dynamically calculating from a list of locations (as below)
    * or as a fixed point, eg: { latitude: 123, longitude: 123, latitudeDelta: 0.1, longitudeDelta: 0.1}
    *************************************************************/
    const region = calculateRegion(locations, { latPadding: 0.05, longPadding: 0.05 })
    this.state = {
      region,
      locations,
      showUserLocation: true
    }
    this.renderMapMarkers = this.renderMapMarkers.bind(this)
    this.onRegionChange = this.onRegionChange.bind(this)
    this.locations = locations
    this.state.angle = '0deg'
    this.state.magicDimensions = { 
      top: 0,
      height: 1000,
      width: 1000
    }
  }

  getRegionLatLngs() {
    const regionLatLngs = toCoords(getRegionBBox(this.state.region));
    const regionFirstDiagonal = [regionLatLngs[0], regionLatLngs[2]];
    const regionSecondDiagonal =  [regionLatLngs[1], regionLatLngs[3]];
    return [regionLatLngs, regionFirstDiagonal, regionSecondDiagonal];
  }

  componentWillReceiveProps (newProps) {
    /* ***********************************************************
    * STEP 3
    * If you wish to recenter the map on new locations any time the
    * Redux props change, do something like this:
    *************************************************************/
    // this.setState({
    //   region: calculateRegion(newProps.locations, { latPadding: 0.1, longPadding: 0.1 })
    // })
  }

  onRegionChange (newRegion) {
    /* ***********************************************************
    * STEP 4
    * If you wish to fetch new locations when the user changes the
    * currently visible region, do something like this:
    *************************************************************/
    // const searchRegion = {
    //   ne_lat: newRegion.latitude + newRegion.latitudeDelta,
    //   ne_long: newRegion.longitude + newRegion.longitudeDelta,
    //   sw_lat: newRegion.latitude - newRegion.latitudeDelta,
    //   sw_long: newRegion.longitude - newRegion.longitudeDelta
    // }
    // Fetch new data...

    this.setState({ region: newRegion });
  }

  calloutPress (location) {
    /* ***********************************************************
    * STEP 5
    * Configure what will happen (if anything) when the user
    * presses your callout.
    *************************************************************/
    console.tron.log(location)
  }

  debugRotate(angle, e) {
    // console.tron.log(this)
    // alert("Rotating " + angle);
    this.setState({
      angle: angle+'deg'
    })
  }

  renderMapMarkers (location) {
    /* ***********************************************************
    * STEP 6
    * Customize the appearance and location of the map marker.
    * Customize the callout in ../Components/MapCallout.js
    *************************************************************/

    return (
      <MapView.Marker key={location.title} coordinate={{latitude: location.latitude, longitude: location.longitude}}>
        <MapCallout location={location} onPress={this.calloutPress} />
      </MapView.Marker>
    )
  }

  renderRegionBBox (coords, index) {
    return (
      <MapView.Polyline
        key={'regionBBox'+index}
        coordinates={coords}
        strokeColor="#F00"
        strokeWidth={1}
      />
    )
  }

  render () {

    return (
      <View style={Styles.container}>
          <Animated.View 
            style={[Styles.magicContainer,
              {
                transform: [{rotate: this.state.angle }]
              }, this.state.magicDimensions]}
          >
            <MapView
              style={Styles.magicMap}
              initialRegion={this.state.region}
              onRegionChange={this.onRegionChange}
              showsUserLocation={this.state.showUserLocation}
            >
              {this.state.locations.map((location) => this.renderMapMarkers(location))}
              {this.getRegionLatLngs().map((coords, i) => this.renderRegionBBox(coords, i))}
            </MapView>
          </Animated.View>
          <View style={Styles.buttonContainer} onPress={this.debugRotate}>
            <TouchableOpacity style={Styles.bubble} onPress={this.debugRotate.bind(this,0)}>
                <Text>Reset Rotation</Text>
            </TouchableOpacity>
          </View>
          <View style={Styles.buttonContainer} onPress={this.debugRotate}>
            <TouchableOpacity style={Styles.bubble} onPress={this.debugRotate.bind(this,30)}>
                <Text>Rotate 30</Text>
            </TouchableOpacity>
          </View>
          <View style={Styles.buttonContainer}>
            <TouchableOpacity style={Styles.bubble} onPress={this.debugRotate.bind(this,60)}>
                <Text>Rotate 60</Text>
            </TouchableOpacity>
          </View>
          <View style={Styles.buttonContainer} onPress={this.debugRotate}>
            <TouchableOpacity style={Styles.bubble} onPress={this.debugRotate.bind(this,90)}>
                <Text>Rotate 90</Text>
            </TouchableOpacity>
          </View>
          {/*
            Map overlays go here
          */}
      </View>
    )
  }
}

const mapStateToProps = (state) => {
  return {
    // ...redux state to props here
  }
}

export default connect(mapStateToProps)(MapViewExample)

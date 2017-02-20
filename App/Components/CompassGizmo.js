import React, { Component } from 'react';
import Orientation from 'react-native-orientation';
import { 
  StatusBar,
  Dimensions,
  StyleSheet,
 } from 'react-native';
import Svg, {
  Circle, 
  Line,
  Text,
} from 'react-native-svg';

let { width, height } = Dimensions.get('window');
statusBarHeight = StatusBar.currentHeight;
height = height-statusBarHeight;
let centerY = Math.round(height/2);
let centerX = Math.round(width/2);
const gizmoRadius = 150;

const toRadians = (angle) => angle * (Math.PI/180);

class CompassGizmo extends Component {
  constructor(props) {
    super(props);
    this.state = {
      orientation: Orientation.getInitialOrientation()
    };
  }
  componentDidMount() {
    // Remember to remove this on unmount
    Orientation.addOrientationListener(this._orientationDidChange.bind(this));
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (this.state.orientation !== nextState.orientation);
  }

  _orientationDidChange(orientation) {
    // Listener seems to fire too early for Dimensions.get() to work
    const tempWidth = width;
    width = height+statusBarHeight;
    height = tempWidth-statusBarHeight;
    centerY = Math.round(height/2);
    centerX = Math.round(width/2);
    console.tron.log(orientation);
    console.tron.log(JSON.stringify({ width, height, centerX, centerY }));
    this.setState({ orientation });
  }

  render() {
    console.tron.log("YOU SHOULD NOT SEE THIS EVER");
    const heading = this.props.heading;
    const radius = gizmoRadius-30;
    const cardinals = ['S','E','N','W'].map((direction, index) => {
      const currentRads = toRadians(heading+index*90);
      return (
        <Text
          key={direction+index}
          fill="none"
          fontWeight="bold"
          strokeOpacity="0.5"
          stroke="white"
          fontSize="24"
          x={centerX+radius*Math.sin(currentRads)}
          y={centerY+radius*Math.cos(currentRads)-12}
          textAnchor="middle"
        >
          {/*direction*/}
        </Text>
      ) 
    });


    return (
      <Svg
        style={styles.overlay}
        height={height}
        width={width}
      >
        <Circle
            cx={centerX}
            cy={centerY}
            r={gizmoRadius}
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
    );
  }
}

export default CompassGizmo

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  }
});


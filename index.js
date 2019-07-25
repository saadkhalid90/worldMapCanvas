let world, projection, path, pathWorld, nodes

// canvas and context
let canvas = d3.select('canvas.worldMap');
let ctx = canvas.node().getContext('2d');

// antimeridian countries (Russia and Fiji)
let AM = {};

// indicator used to color countries
let indName = 'Right to Strike';

let indDict = makeDict(indTitles, indOptionKey);
let colArr = ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99'];

// scale to color countries
let colScale = d3.scaleOrdinal().domain(Object.keys(indDict[indName])).range(colArr);

// transition time and total frames for transition
let transTime = 1000;
let framesTrans = (transTime/1000) * 60;

// get retine ratio of device
function getRetinaRatio() {
    var devicePixelRatio = window.devicePixelRatio || 1
    var c = document.createElement('canvas').getContext('2d')
    var backingStoreRatio = [
        c.webkitBackingStorePixelRatio,
        c.mozBackingStorePixelRatio,
        c.msBackingStorePixelRatio,
        c.oBackingStorePixelRatio,
        c.backingStorePixelRatio,
        1
    ].reduce(function(a, b) { return a || b })

    return devicePixelRatio / backingStoreRatio
}

var ratio = getRetinaRatio()

// scale width and height according to retina ratio
var width = canvas.attr('width');
var height = canvas.attr('height');
var scaledWidth = width * ratio;
var scaledHeight = height * ratio;

// styling with actual (unscaled) width and height to maintain size
canvas.attr('width', scaledWidth)
      .attr('height', scaledHeight)
      .style('width', width + 'px')
      .style('height', height + 'px')

// scale context according to device ratio
ctx.scale(ratio, ratio)

// defining projection for the map
projection = d3.geoRobinson()
  .scale(150 * 1.4)
  .center([-30,23]);
// path generating function
path = d3.geoPath().projection(projection)//.context(ctx);



async function readAndDraw(){
  // read in data (world map, ILR indicators and world bank Labor force)
  world = await d3.json('worldMap.topojson');
  let ilr = await d3.csv("LabCompInd/LabCompIndCode.csv");
  let WB = await d3.csv("LaborForce/labForceCenters.csv");

  // filter Antarctica from the world geometry
  world.objects.worldMap.geometries = world.objects.worldMap.geometries.filter(d => {
    return d.properties.ADMIN != "Antarctica";
  })

  // data with neighbors of all countries
  let neighbors = topojson.neighbors(world.objects.worldMap.geometries);
  // features of all countries from topjson
  nodes = topojson.feature(world, world.objects.worldMap).features;
  // Join data (ILR and WB)
  nodes = joinIndsLabData(nodes, ilr, WB);


  // Anti meridian countries
  let RUS_Datum = nodes.filter(d => d.properties.ADM0_A3 == "RUS")[0];
  let FJI_Datum = nodes.filter(d => d.properties.ADM0_A3 == "FJI")[0];

  // computing paths of antimeridian countries
  AM.RUS = path(RUS_Datum);
  AM.FJI = path(FJI_Datum);

  //nodes = nodes.filter(d => d.properties.CONTINENT === 'Africa');

  // compute centroids
  nodes.forEach(function(node, i) {
    var centroid = path.centroid(node);

    node.x0 = centroid[0];
    node.y0 = centroid[1];

    cleanUpGeometry(node);
  });

  // This converts a json into an array each element corresponding to one path
  pathWorld = topojson.feature(world, world.objects.worldMap).features;

  // extract labor force of countries and compute and radius scale
  let lF = nodes.map(d => d.data.WB ? +d.data.WB['2018'] : 0);
  let maxLF = d3.max(lF);

  let bubScale = d3.scaleSqrt()
                  .domain([0, maxLF])
                  .range([0, 80]);


  //// Simulate Shit ////

  async function forceSimulate(){
    return new Promise(function(res){
      nodes.forEach(function(node) {
        node.x = node.x0;
        node.y = node.y0;
        node.r = bubScale(node.data.WB ? +node.data.WB['2018'] : 0);
      });

      // var links = d3.merge(neighbors.map(function(neighborSet, i) {
      //   return neighborSet.filter(j => nodes[j]).map(function(j) {
      //     return {source: i, target: j, distance: nodes[i].r + nodes[j].r + 2};
      //   });
      // }));
      //
      // simulation = d3.forceSimulation(nodes).stop();
          // .force("cx", d3.forceX().x(d => width / 2).strength(0.02))
          // .force("cy", d3.forceY().y(d => height / 2).strength(0.02))
          // //.force("link", d3.forceLink(links).distance(d => d.distance))
          // .force("x", d3.forceX().x(d => d.x).strength(0.1))
          // .force("y", d3.forceY().y(d => d.y).strength(0.1))
          // .force("collide", d3.forceCollide().strength(0.8).radius(d => d.r + 2))
          // .stop();

      // while (simulation.alpha() > 0.01) {
      //   simulation.tick();
      // }
      res();
    })
  }

  async function simulate() {

    await forceSimulate();

    // compute circle coordinates and interpolator functions
    nodes.forEach(function(node, idx){
        var circle = pseudocircle(node),
            closestPoints = node.coordinates.slice(1).map(function(ring){
              var i = d3.scan(circle.map(point => distance(point, ring.centroid)));
              return ring.map(() => circle[i]);
            });
            //interpolator = d3.interpolateArray(node.coordinates, [circle, ...closestPoints]),
            interpolatorS = d3.interpolateString(pathString(node.coordinates), pathString([circle, ...closestPoints]));

        //node.interpolator = interpolator;
        node.interpolatorS = interpolatorS;
    });

    // computing intermediate states( between country path and associated circle )
    nodes.forEach(function(d, i){
    	d.interpState = [];
    	for (var j = 0; j < framesTrans; j++){
    		d.interpState.push(new Path2D(d.interpolatorS(j/(framesTrans-1))));
    	}
    })

    // draw map for the first frame
    draw(0);
  }

  await simulate();

  // animate using d3 timer
  // console.log('performance.now',performance.now());
  // console.log('d3.now',d3.now(), Date.now());

  let notFirstRun;
  var t = d3.timer(function(elapsed) {
    console.log(elapsed);
    if(!notFirstRun){
      console.log(performance.now());
    }
    notFirstRun = notFirstRun || true;
    console.log(Math.round(elapsed/transTime * 60));

    //let calcInterpVal = elapsed/transTime;
    if (elapsed <= transTime + 200){
      draw(elapsed);
    }
    else {
      t.stop();
      //  draw(calcInterpVal);
    }
  }, Math.abs(performance.now() - d3.now()) + 3000);


  ///////////////////////
}

readAndDraw();

// draw function called in each frame
function draw(elapsed){
  ctx.clearRect(0, 0, canvas.node().width, canvas.node().height);

  for (var i = 0, len = nodes.length; i < len; i++){
    var d = nodes[i];
    ctx.save();
    ctx.globalAlpha = .9;
    var transIdx = Math.round(elapsed/transTime * framesTrans)
    var pathIns = transIdx < framesTrans - 1 ? d.interpState[transIdx] : d.interpState[framesTrans - 1];
    ctx.fillStyle = d.data.ilr ? colScale(d.data.ilr[indName]) : 'grey';
    ctx.fill(pathIns)
    ctx.lineWidth = '1'
    ctx.strokeStyle = 'black'
    ctx.stroke();
    ctx.restore();
  }
}



function pathToArr(path){
  // split by Z (get an array corresponding to each polygon)
  // replace M from each element of array and split by L
  // split each coordinate by , and convert them into numeric
  let arrCoords = path.split("Z").map(d => d.replace("M", "").split("L").map(coords => coords.split(",").map(coord => + coord)));
  // remove an array with a zero at the end
  arrCoords.pop();
  return arrCoords;
}

function joinIndsLabData(nodes, ilr, WB){
  return nodes.map(country => {
    let ctryCode = country.properties.ADM0_A3;

    // introduce a new attribute that will hold ilr and WB
    country.data = {};

    let ilrFilt = ilr.filter(d => d['Map Code'] == ctryCode);
    let WBFilt = WB.filter(d => d['Country Code'] == ctryCode);

    country.data.ilr = ilrFilt.length > 0 ? ilrFilt[0] : null;
    country.data.WB = WBFilt.length > 0 ? WBFilt[0] : null;

    return country;
  })
}

function pseudocircle(node) {
  return node.coordinates[0].map(function(point){
    var angle = node.startingAngle + 2 * Math.PI * (point.along / node.perimeter);
    return [
      Math.cos(angle) * node.r + node.x,
      Math.sin(angle) * node.r + node.y
    ];
  });
}

function cleanUpGeometry(node) {

  if (node.properties.ADM0_A3 == 'RUS' | node.properties.ADM0_A3 == 'FJI'){
    node.coordinates = pathToArr(AM[node.properties.ADM0_A3]);
    node.coordinates.forEach(function(polygon){
      polygon.centroid = d3.polygonCentroid(polygon);
      polygon.area = Math.abs(d3.polygonArea(polygon))
    })
  }
  else {

    node.coordinates = (node.geometry.type === "Polygon" ? [node.geometry.coordinates] : node.geometry.coordinates);


    node.coordinates = node.coordinates.map(function(polygon){
      polygon[0] = polygon[0].map(d => projection(d));
      polygon[0].area = Math.abs(d3.polygonArea(polygon[0]));
      polygon[0].centroid = d3.polygonCentroid(polygon[0]);
      return polygon[0];
    });
  }


  node.coordinates.sort((a, b) => b.area - a.area);

  // perimeter of the largest polygon in the group of polygons
  node.perimeter = d3.polygonLength(node.coordinates[0]);

  // Optional step, but makes for more circular circles
  bisect(node.coordinates[0], node.perimeter / 72);

  node.coordinates[0].reduce(function(prev, point){
    point.along = prev ? prev.along + distance(point, prev) : 0;
    node.perimeter = point.along;
    return point;
  }, null);



  node.startingAngle = Math.atan2(node.coordinates[0][0][1] - node.y0, node.coordinates[0][0][0] - node.x0);
}

function bisect(ring, maxSegmentLength) {
  //console.log("before loop", ring);
  for (var i = 0; i < ring.length; i++) {
    var a = ring[i],
    b = i === ring.length - 1 ? ring[0] : ring[i + 1];

    while (distance(a, b) > maxSegmentLength) {
      b = midpoint(a, b);
      ring.splice(i + 1, 0, b);
    }
  }
}

function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
}

function midpoint(a, b) {
  return [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5];
}

function pathString(d) {
  return (d.coordinates || d).map(ring => "M" + ring.join("L") + "Z").join(" ");
}


function getCountryCode(datum){
  return datum.properties.ADM0_A3
}

function makeDict(keys, values){
  let dict = {};
  keys.forEach((d, i) => {
    dict[d] = values[i];
  });

  return dict;
}

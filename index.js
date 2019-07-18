let world, projection, path, pathWorld, nodes

let canvas = d3.select('canvas.worldMap');
let ctx = canvas.node().getContext('2d');

let AM = {};

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
//var ratio = 1;

var width = canvas.attr('width');
var height = canvas.attr('height');
var scaledWidth = width * ratio;
var scaledHeight = height * ratio;


canvas.attr('width', scaledWidth)
      .attr('height', scaledHeight)
      .style('width', width + 'px')
      .style('height', height + 'px')

ctx.scale(ratio, ratio)

projection = d3.geoRobinson()
  .scale(150 * 1.4)
  .center([-30,23]);

path = d3.geoPath().projection(projection)//.context(ctx);



async function readAndDraw(){
  world = await d3.json('worldMap.topojson');
  let ilr = await d3.csv("LabCompInd/LabCompIndCode.csv");
  let WB = await d3.csv("LaborForce/labForceCenters.csv");

  // filter Antarctica from the world geometry
  world.objects.worldMap.geometries = world.objects.worldMap.geometries.filter(d => {
    return d.properties.ADMIN != "Antarctica";
  })

  let neighbors = topojson.neighbors(world.objects.worldMap.geometries);
  nodes = topojson.feature(world, world.objects.worldMap).features;

  nodes = joinIndsLabData(nodes, ilr, WB);


  //  this path will be used to compute the d feature of each geometrical path in a map

  let RUS_Datum = nodes.filter(d => d.properties.ADM0_A3 == "RUS")[0];
  let FJI_Datum = nodes.filter(d => d.properties.ADM0_A3 == "FJI")[0];

  AM.RUS = path(RUS_Datum);
  AM.FJI = path(FJI_Datum);

  nodes.forEach(function(node, i) {

    var centroid = path.centroid(node);

    node.x0 = centroid[0];
    node.y0 = centroid[1];

    cleanUpGeometry(node);

  });

  // This converts a json into an array each element corresponding to one path
  pathWorld = topojson.feature(world, world.objects.worldMap).features;

  //draw()

  let lF = nodes.map(d => d.data.WB ? +d.data.WB['2018'] : 0);
  let maxLF = d3.max(lF);

  let bubScale = d3.scaleSqrt()
                  .domain([0, maxLF])
                  .range([0, 80]);


  //// Simulate Shit ////

  simulate();

  function simulate() {
    nodes.forEach(function(node) {
      node.x = node.x0;
      node.y = node.y0;
      node.r = bubScale(node.data.WB ? +node.data.WB['2018'] : 0);
    });

    var links = d3.merge(neighbors.map(function(neighborSet, i) {
      return neighborSet.filter(j => nodes[j]).map(function(j) {
        return {source: i, target: j, distance: nodes[i].r + nodes[j].r + 2};
      });
    }));

    var simulation = d3.forceSimulation(nodes)
        .force("cx", d3.forceX().x(d => width / 2).strength(0.02))
        .force("cy", d3.forceY().y(d => height / 2).strength(0.02))
        .force("link", d3.forceLink(links).distance(d => d.distance))
        .force("x", d3.forceX().x(d => d.x).strength(0.1))
        .force("y", d3.forceY().y(d => d.y).strength(0.1))
        .force("collide", d3.forceCollide().strength(0.8).radius(d => d.r + 2))
        .stop();

    while (simulation.alpha() > 0.01) {
      simulation.tick();
    }

    nodes.forEach(function(node, idx){
      var circle = pseudocircle(node),
          closestPoints = node.coordinates.slice(1).map(function(ring){
            var i = d3.scan(circle.map(point => distance(point, ring.centroid)));
            return ring.map(() => circle[i]);
          }),
          interpolator = d3.interpolateArray(node.coordinates, [circle, ...closestPoints]);

      node.interpolator = interpolator;
    });

    draw(0);

    let transTime = 2500;
    // animate using d3 timer
    var t = d3.timer(function(elapsed) {
      let calcInterpVal = elapsed/transTime;
      if (elapsed <= transTime){
        draw(calcInterpVal);
      }
      else {
        t.stop();
      }
    }, 2000);

  }

  ///////////////////////
}

readAndDraw();

function draw(interpVal){
  ctx.clearRect(0, 0, canvas.node().width, canvas.node().height);

  nodes.forEach(function(d, i){
    ctx.beginPath();
    let coords = d.interpolator(interpVal);
    drawPathCanvas(ctx, coords);

    ctx.fillStyle = '#FBC02D'
    ctx.fill()
    ctx.lineWidth = '.5'
    ctx.strokeStyle = 'black'
    ctx.stroke();
  })
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

function drawPathCanvas(ctx, coords){
  // draw path in canvas using an array of coordinates
  coords.forEach(function(shape){
    shape.forEach(function(point, index){
      if (index == 0){
        ctx.moveTo(+point[0], +point[1])
      }
      else {
        ctx.lineTo(+point[0], +point[1])
      }
    })
    ctx.closePath();
  })
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
  //console.log("After reduce and start angle", node.rings[0]);
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

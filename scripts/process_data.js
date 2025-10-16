import fs from 'fs';
import config from '../config.js';
import * as turf from '@turf/turf';
import { createParseStream } from 'big-json';

const optimizeBuilding = (unOptimizedBuilding) => {
  return {
    b: [unOptimizedBuilding.minX, unOptimizedBuilding.minY, unOptimizedBuilding.maxX, unOptimizedBuilding.maxY],
    f: unOptimizedBuilding.foundationDepth,
    p: unOptimizedBuilding.polygon,
  }
};

const optimizeIndex = (unOptimizedIndex) => {
  return {
    cs: unOptimizedIndex.cellHeightCoords,
    bbox: [unOptimizedIndex.minLon, unOptimizedIndex.minLat, unOptimizedIndex.maxLon, unOptimizedIndex.maxLat],
    grid: [unOptimizedIndex.cols, unOptimizedIndex.rows],
    cells: Object.keys(unOptimizedIndex.cells).map((key) => [...key.split(',').map((n) => Number(n)), ...unOptimizedIndex.cells[key]]),
    buildings: unOptimizedIndex.buildings.map((unOptimizedBuilding) => optimizeBuilding(unOptimizedBuilding)),
    stats: {
      count: unOptimizedIndex.buildings.length,
      maxDepth: unOptimizedIndex.maxDepth,
    }
  }
};

// how much square footage we should probably expect per resident of this housing type
// later on ill calculate the cross section of the building's square footage, 
// then multiply that but the total number of floors to get an approximate full square footage number
// i can then divide by the below number to get a rough populaion stat
const squareFeetPerPopulation = {
  yes: 600, // most likely a SFH
  apartments: 240,
  barracks: 100, // google said 70-90, but imma bump it up a bit tbh
  bungalow: 600, // sfh
  cabin: 600, // sfh
  detached: 600, // sfh
  annexe: 240, // kinda like apartments
  dormitory: 125, // good lord
  farm: 600, // sfh
  ger: 240, // technically sfh, but generally usually smaller and more compact. honorary apartment. TIL "ger" is mongolian for the english word "yurt"
  hotel: 240, // gonna count these as apartments because hotel guests use transit too
  house: 600, // sfh
  houseboat: 600, // interdasting
  residential: 600, // could be anything, but im assuimg sfh here
  semidetached_house: 400, // duplex
  static_caravan: 500,
  stilt_house: 600,
  terrace: 500, // townhome
  tree_house: 240, // fuck it
  trullo: 240, // there is nothing scientific here, its all fucking vibes
};

const squareFeetPerJob = {
  commercial: 150, // non specific, restaraunts i guess?
  industrial: 500, // vibes vibes vibes vibes!!!!!,
  kiosk: 50, // its all vibes baby
  office: 150, // all of my vibes are 100% meat created
  retail: 300,
  supermarket: 300,
  warehouse: 500,
  // the following are all religious and im assuming ~100 square feet, not for job purposes, 
  // but for the fact that people go to religious institutions
  // might use a similar trick for sports stadiums
  religious: 100,
  cathedral: 100,
  chapel: 100,
  church: 100,
  kingdom_hall: 100,
  monastery: 100,
  mosque: 100,
  presbytery: 100,
  shrine: 100,
  synagogue: 100,
  temple: 100,
  // end of religious
  bakehouse: 300,
  college: 250, // collge/uni is a job
  fire_station: 500,
  government: 150,
  gatehouse: 150,
  hospital: 150,
  kindergarten: 100,
  museum: 300,
  public: 300,
  school: 100,
  train_station: 1000,
  transportation: 1000,
  university: 250,
  // sports time! im going to treat these like offices because i said so.
  // i think itll end up creating demand thats on average what stadiums see traffic wise. not sure
  grandstand: 150,
  pavilion: 150,
  riding_hall: 150,
  sports_hall: 150,
  sports_centre: 150,
  stadium: 150,
};

const processPlaceConnections = (place, rawBuildings, rawPlaces) => {
  let neighborhoods = {};
  let centersOfNeighborhoods = {};
  let calculatedBuildings = {};

  // finding areas of neighborhoods
  rawPlaces.forEach((place) => {
    if (place.tags.place && (place.tags.place == 'quarter' || place.tags.place == 'neighbourhood')) {
      neighborhoods[place.id] = place;
      if (place.type == 'node') {
        centersOfNeighborhoods[place.id] = [place.lon, place.lat];
      } else if (place.type == 'way' || place.type == 'relation') {
        const center = [(place.bounds.minlon + place.bounds.maxlon) / 2, (place.bounds.minlat + place.bounds.maxlat) / 2];
        centersOfNeighborhoods[place.id] = center;
      }
    }
  });

  const centersOfNeighborhoodsFeatureCollection = turf.featureCollection(
    Object.keys(centersOfNeighborhoods).map((placeID) =>
      turf.point(centersOfNeighborhoods[placeID], {
        placeID,
        name: neighborhoods[placeID].tags.name,
      })
    )
  );

  // splitting everything into areas
  const voronoi = turf.voronoi(centersOfNeighborhoodsFeatureCollection, {
    bbox: place.bbox,
  })
  voronoi.features = voronoi.features.filter((feature) => feature);

  // sorting buildings between residential and commercial
  rawBuildings.forEach((building) => {
    if (building.tags.building) { // should always be true, but why not
      const __coords = building.geometry.map((point) => [point.lon, point.lat]);
      if (__coords.length < 3) return;
      if (__coords[0][0] !== __coords[__coords.length - 1][0] || __coords[0][1] !== __coords[__coords.length - 1][1]) __coords.push(__coords[0]);
      const buildingGeometry = turf.polygon([__coords]);
      let buildingAreaMultiplier = Math.max(Number(building.tags['building:levels']), 1); // assuming a single story if no level data
      if (isNaN(buildingAreaMultiplier)) buildingAreaMultiplier = 1;
      const buildingArea = turf.area(buildingGeometry) * buildingAreaMultiplier * 10.7639; // that magic number converts from square meters to square feet
      const buildingCenter = [(building.bounds.minlon + building.bounds.maxlon) / 2, (building.bounds.minlat + building.bounds.maxlat) / 2];

      if (squareFeetPerPopulation[building.tags.building]) { // residential
        const approxPop = Math.floor(buildingArea / squareFeetPerPopulation[building.tags.building]);
        calculatedBuildings[building.id] = {
          ...building,
          approxPop,
          buildingCenter,
        };
      } else if (squareFeetPerJob[building.tags.building]) { // commercial/jobs
        const approxJobs = Math.floor(buildingArea / squareFeetPerJob[building.tags.building]);

        calculatedBuildings[building.id] = {
          ...building,
          approxJobs,
          buildingCenter,
        };
      }
    }
  });

  // so we can do like, stuff with it
  const buildingsAsFeatureCollection = turf.featureCollection(
    Object.values(calculatedBuildings).map((building) =>
      turf.point(building.buildingCenter, { buildingID: building.id })
    )
  );

  let totalPopulation = 0;
  let totalJobs = 0;
  let finalVoronoiMembers = {}; // what buildings are in each voronoi
  let finalVoronoiMetadata = {}; // additional info on population and jobs

  voronoi.features.forEach((feature) => {
    const buildingsWhichExistWithinFeature = turf.pointsWithinPolygon(buildingsAsFeatureCollection, feature);
    finalVoronoiMembers[feature.properties.placeID] = buildingsWhichExistWithinFeature.features;
    const finalFeature = {
      ...feature.properties,
      totalPopulation: 0,
      totalJobs: 0,
      percentOfTotalPopulation: null,
      percentOfTotalJobs: null,
    };

    buildingsWhichExistWithinFeature.features.forEach((feature) => {
      const building = calculatedBuildings[feature.properties.buildingID];
      finalFeature.totalPopulation += (building.approxPop ?? 0);
      finalFeature.totalJobs += (building.approxJobs ?? 0);
      totalPopulation += (building.approxPop ?? 0);
      totalJobs += (building.approxJobs ?? 0);
    });

    finalVoronoiMetadata[feature.properties.placeID] = finalFeature;
  });

  let finalNeighborhoods = {};
  let neighborhoodConnections = [];

  // creating total percents and setting up final dicts
  Object.values(finalVoronoiMetadata).forEach((place) => {
    finalVoronoiMetadata[place.placeID].percentOfTotalPopulation = place.totalPopulation / totalPopulation;
    finalVoronoiMetadata[place.placeID].percentOfTotalJobs = place.totalJobs / totalJobs;

    finalNeighborhoods[place.placeID] = {
      id: place.placeID,
      location: centersOfNeighborhoods[place.placeID],
      jobs: place.totalJobs,
      residents: place.totalPopulation,
      popIds: [],
    }
  });

  Object.values(finalVoronoiMetadata).forEach((outerPlace) => {
    // trust the process bro
    Object.values(finalVoronoiMetadata).forEach((innerPlace) => {
      //const connectionSizeBasedOnResidencePercent = outerPlace.percentOfTotalPopulation * innerPlace.totalJobs;
      const connectionSizeBasedOnJobsPercent = innerPlace.percentOfTotalJobs * outerPlace.totalPopulation;
      const connectionDistance = turf.length(turf.lineString([
        centersOfNeighborhoods[outerPlace.placeID],
        centersOfNeighborhoods[innerPlace.placeID],
      ]), { units: 'meters' });
      const conncetionSeconds = connectionDistance * 0.12; // very scientific (hey, this is something i got from the subwaybuilder data)
      neighborhoodConnections.push({
        residenceId: outerPlace.placeID,
        jobId: innerPlace.placeID,
        size: Math.round(connectionSizeBasedOnJobsPercent), // SO MANY VIBES EVERYTHING IS JUST VIBES FUCK IT WE BALL
        drivingDistance: Math.round(connectionDistance),
        drivingSeconds: Math.round(conncetionSeconds),
      })
    });
  });

  // need to populate popIds within finalNeighborhoods
  neighborhoodConnections = neighborhoodConnections.map((connection, i) => {
    const id = i.toString();
    finalNeighborhoods[connection.jobId].popIds.push(id);
    return {
      ...connection,
      id,
    }
  });

  return {
    points: Object.values(finalNeighborhoods),
    pops: neighborhoodConnections,
  }
};

const processBuildings = (place, rawBuildings) => {
  // looking at the sample data, cells are approximately 100 meters long and wide, so thats what im gonna go with
  let minLon = 9999;
  let minLat = 9999;
  let maxLon = -999;
  let maxLat = -999;

  let processedBuildings = {};

  rawBuildings.forEach((building, i) => {
    let minBuildingLon = 9999;
    let minBuildingLat = 9999;
    let maxBuildingLon = -999;
    let maxBuildingLat = -999;

    const __points = building.geometry.map((coord) => {
      // overall bbox
      if (coord.lon < minLon) minLon = coord.lon;
      if (coord.lat < minLat) minLat = coord.lat;
      if (coord.lon > maxLon) maxLon = coord.lon;
      if (coord.lat > maxLat) maxLat = coord.lat;

      // building bbox
      if (coord.lon < minBuildingLon) minBuildingLon = coord.lon;
      if (coord.lat < minBuildingLat) minBuildingLat = coord.lat;
      if (coord.lon > maxBuildingLon) maxBuildingLon = coord.lon;
      if (coord.lat > maxBuildingLat) maxBuildingLat = coord.lat;

      return [coord.lon, coord.lat];
    });
    if (__points.length < 3) return;
    if (__points[0][0] !== __points[__points.length - 1][0] || __points[0][1] !== __points[__points.length - 1][1]) __points.push(__points[0]);
    const buildingPolygon = turf.polygon([__points]);
    const buildingCenter = turf.centerOfMass(buildingPolygon);

    processedBuildings[i] = {
      bbox: {
        minLon: minBuildingLon,
        maxLat: minBuildingLat,
        maxLon: maxBuildingLon,
        maxLat: maxBuildingLat,
      },
      center: buildingCenter.geometry.coordinates,
      ...building,
      id: i,
      geometry: buildingPolygon.geometry.coordinates,
    }
  });

  // creating the grid of cells
  // creating two lines that we will use to metaphorically split up the bbox
  const verticalLine = turf.lineString([[minLon, minLat], [minLon, maxLat]]);
  const horizontalLine = turf.lineString([[minLon, minLat], [maxLon, minLat]]);

  const verticalLength = turf.length(verticalLine, { units: 'meters' });
  const horizontalLength = turf.length(horizontalLine, { units: 'meters' });

  let columnCoords = []; // x, made by going along horizontal line
  let rowCoords = []; // y, made by going along vertical line

  let cellSize = null;

  // generating the column coords
  for (let x = 0; x <= horizontalLength; x += 100) {
    const minX = turf.along(horizontalLine, x, { units: 'meters' }).geometry.coordinates[0];
    columnCoords.push(minX); //minX will be inclusive
  };

  // generating the row coords
  for (let y = 0; y <= verticalLength; y += 100) {
    const minY = turf.along(verticalLine, y, { units: 'meters' }).geometry.coordinates[1];

    if (y == 100) cellSize = Number((minY - rowCoords[0]).toFixed(4)); // idk why we need this, but its in the data format!

    rowCoords.push(minY); //minY will be inclusive
  };

  // figuring out what buildings are in what cells

  // longitude/x
  for (let x = 0; x < columnCoords.length; x++) {
    const thisMinLon = columnCoords[x];
    const nextMinLon = x == columnCoords.length - 1 ? 999 : columnCoords[x + 1]; // if in the last column, "next" min longitude value is just big

    const buildingsThatFit = Object.values(processedBuildings).filter((building) => thisMinLon <= building.center[0] && nextMinLon > building.center[0]);
    buildingsThatFit.forEach((building) => {
      processedBuildings[building.id].xCellCoord = x;
    })
  };

  // latitude/y
  for (let y = 0; y < rowCoords.length; y++) {
    const thisMinLon = rowCoords[y];
    const nextMinLon = y == rowCoords.length - 1 ? rowCoords[y] + cellSize : rowCoords[y + 1]; // if in the last row, "next" min latitude value is just big

    if (y == rowCoords.length - 1) { // adjusting the maxLat to fix the grid
      maxLat = rowCoords[y] + cellSize;
    }

    const buildingsThatFit = Object.values(processedBuildings).filter((building) => thisMinLon <= building.center[1] && nextMinLon > building.center[1]);
    buildingsThatFit.forEach((building) => {
      processedBuildings[building.id].yCellCoord = y;
    })
  };

  // building the dictionary of cells, finally
  let cellsDict = {};
  Object.values(processedBuildings).forEach((building) => {
    const buildingCoord = `${building.xCellCoord},${building.yCellCoord}`;
    if (!cellsDict[buildingCoord]) cellsDict[buildingCoord] = [];
    cellsDict[buildingCoord].push(building.id);
  });

  let maxDepth = 1;

  const optimizedIndex = optimizeIndex({
    cellHeightCoords: cellSize,
    minLon,
    minLat,
    maxLon,
    maxLat,
    cols: columnCoords.length,
    rows: rowCoords.length,
    cells: cellsDict,
    buildings: Object.values(processedBuildings).map((building) => {
      if (
        building.tags['building:levels:underground'] &&
        Number(building.tags['building:levels:underground']) > maxDepth
      )
        maxDepth = Number(building.tags['building:levels:underground']);

      return {
        minX: building.bbox.minLon,
        minY: building.bbox.minLat,
        maxX: building.bbox.maxLon,
        maxY: building.bbox.maxLat,
        foundationDepth: building.tags['building:levels:underground'] ? Number(building.tags['building:levels:underground']) : 1,
        polygon: building.geometry,
      }
    }),
    maxDepth,
  });

  return optimizedIndex;
}

const processAllData = async (place) => {
  const readJsonFile = (filePath) => {
    return new Promise((resolve, reject) => {
      const parseStream = createParseStream();
      let jsonData;

      parseStream.on('data', (data) => {
        jsonData = data;
      });

      parseStream.on('end', () => {
        resolve(jsonData);
      });

      parseStream.on('error', (err) => {
        reject(err);
      });

      fs.createReadStream(filePath).pipe(parseStream);
    });
  };

  console.log('Reading raw data for', place.code);
  const rawBuildings = await readJsonFile(`./raw_data/${place.code}/buildings.json`);
  const rawPlaces = await readJsonFile(`./raw_data/${place.code}/places.json`);

  console.log('Processing Buildings for', place.code)
  const processedBuildings = processBuildings(place, rawBuildings);
  console.log('Processing Connections/Demand for', place.code)
  const processedConnections = processPlaceConnections(place, rawBuildings, rawPlaces);

  console.log('Writing finished data for', place.code)
  fs.writeFileSync(`./processed_data/${place.code}/buildings_index.json`, JSON.stringify(processedBuildings), { encoding: 'utf8' });
  fs.cpSync(`./raw_data/${place.code}/roads.geojson`, `./processed_data/${place.code}/roads.geojson`);
  fs.writeFileSync(`./processed_data/${place.code}/demand_data.json`, JSON.stringify(processedConnections), { encoding: 'utf8' });
};

if (!fs.existsSync('./processed_data')) fs.mkdirSync('./processed_data');
config.places.forEach((place) => {
  (async () => {
    if (fs.existsSync(`./processed_data/${place.code}`)) fs.rmSync(`./processed_data/${place.code}`, { recursive: true, force: true });
    fs.mkdirSync(`./processed_data/${place.code}`)
    await processAllData(place);
    console.log(`Finished processing ${place.code}.`);
  })();
});
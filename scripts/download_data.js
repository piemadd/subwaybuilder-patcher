import fs from 'fs';
import { createParseStream, createStringifyStream } from 'big-json';
import { Readable } from "stream";
import config from '../config.js';

const convertBbox = (bbox) => [bbox[1], bbox[0], bbox[3], bbox[2]];

const runQuery = async (query) => {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    "credentials": "omit",
    "headers": {
      "User-Agent": "SubwayBuilder-Patcher (https://github.com/piemadd/subwaybuilder-patcher)",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.5"
    },
    "body": `data=${encodeURIComponent(query)}`,
    "method": "POST",
    "mode": "cors"
  });

  if (!res.ok) {
    console.log('Error fetching data, try again in ~30 seconds');
    process.exit(1);
  };

  let finalData = null;

  const parseStream = createParseStream();
  Readable.fromWeb(res.body).pipe(parseStream);

  // Listen for parsed objects
  parseStream.on('data', (data) => {
    finalData = data;
  });

  parseStream.on('error', (error) => {
    console.error('Error parsing JSON stream:', error);
    console.log('Error fetching data, try again in ~30 seconds');
    process.exit(1);
  });

  await new Promise((resolve, reject) => {
    parseStream.on('end', resolve);
    parseStream.on('error', reject);
  });

  return finalData;
};

const fetchRoadData = async (bbox) => {
  const roadQuery = `
[out:json][timeout:180];
(
  way["highway"="motorway"](${bbox.join(',')});
  way["highway"="trunk"](${bbox.join(',')});
  way["highway"="primary"](${bbox.join(',')});
  way["highway"="secondary"](${bbox.join(',')});
  way["highway"="tertiary"](${bbox.join(',')});
  way["highway"="residential"](${bbox.join(',')});
);
out geom;`

  const data = await runQuery(roadQuery);

  const roadTypes = {
    motorway: 'highway',
    trunk: 'major',
    primary: 'major',
    secondary: 'minor',
    tertiary: 'minor',
    residential: 'minor',
  };

  return {
    "type": "FeatureCollection", "features": data.elements.map((element) => {

      return {
        "type": "Feature",
        "properties": {
          roadClass: roadTypes[element.tags.highway],
          structure: "normal", // this doesnt change...lol
          name: element.tags.highway ?? "",
        },
        "geometry": {
          "coordinates": element.geometry.map((coord) => [coord.lon, coord.lat]),
          "type": "LineString"
        }
      }
    })
  }
};

const fetchBuildingsData = async (bbox) => {
  const buildingQuery = `
[out:json][timeout:180];
(
  way["building"](${bbox.join(',')});
);
out geom;`

  const data = await runQuery(buildingQuery);

  return data.elements;
};

const fetchPlacesData = async (bbox) => {
  const neighborhoodsQuery = `
[out:json][timeout:180];
(
  nwr["place"="neighbourhood"](${bbox.join(',')});
  nwr["place"="quarter"](${bbox.join(',')});
  nwr["amenity"](${bbox.join(',')});
);
out geom;`

  const data = await runQuery(neighborhoodsQuery);

  return data.elements;
};

/*
[out:json][timeout:180];
nwr["place"="neighbourhood"]({{bbox}});
out geom;
*/

const fetchAllData = async (place) => {
  if (!fs.existsSync(`./raw_data/${place.code}`)) fs.mkdirSync(`./raw_data/${place.code}`);

  console.log(`Fetching ${place.name} (${place.code}) - May take a while`);
  const convertedBoundingBox = convertBbox(place.bbox);
  console.time(`${place.name} (${place.code}) Road Data Fetch`);
  const roadData = await fetchRoadData(convertedBoundingBox);
  console.timeEnd(`${place.name} (${place.code}) Road Data Fetch`);
  console.time(`${place.name} (${place.code}) Building Data Fetch`);
  const buildingData = await fetchBuildingsData(convertedBoundingBox);
  console.timeEnd(`${place.name} (${place.code}) Building Data Fetch`);
  console.time(`${place.name} (${place.code}) Places Data Fetch`);
  const placesData = await fetchPlacesData(convertedBoundingBox);
  console.timeEnd(`${place.name} (${place.code}) Places Data Fetch`);

  try {
    console.time(`Writing roads for ${place.name} (${place.code})`);
    fs.writeFileSync(`./raw_data/${place.code}/roads.geojson`, JSON.stringify(roadData), { encoding: 'utf8' });
    console.timeEnd(`Writing roads for ${place.name} (${place.code})`);
    console.time(`Writing buildings for ${place.name} (${place.code})`);
    fs.writeFileSync(`./raw_data/${place.code}/buildings.json`, JSON.stringify(buildingData), { encoding: 'utf8' });
    console.timeEnd(`Writing buildings for ${place.name} (${place.code})`);
    console.time(`Writing places for ${place.name} (${place.code})`);
    fs.writeFileSync(`./raw_data/${place.code}/places.json`, JSON.stringify(placesData), { encoding: 'utf8' });
    console.timeEnd(`Writing places for ${place.name} (${place.code})`);
  } catch (e) {
    console.log(`Falling back to streaming writes for large files in ${place.name} (${place.code})...`);

    const writeWithStream = (data, path) => new Promise((resolve, reject) => {
      const stringifyStream = createStringifyStream({ body: data });
      const writeStream = fs.createWriteStream(path, { encoding: 'utf8' });
      stringifyStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      stringifyStream.on('error', reject);
      writeStream.on('error', reject);
    });

    await Promise.all([
      writeWithStream(roadData, `./raw_data/${place.code}/roads.geojson`),
      writeWithStream(buildingData, `./raw_data/${place.code}/buildings.json`),
      writeWithStream(placesData, `./raw_data/${place.code}/places.json`)
    ]);

    console.log(`Finished writing files for ${place.name} (${place.code})`);
  }
};

const main = async () => {
  if (!fs.existsSync('./raw_data')) fs.mkdirSync('./raw_data');
  for (const place of config.places) {
    await fetchAllData(place);
  }
  console.log('All places processed.');
  process.exit(0);
};

main();
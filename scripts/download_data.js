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

const getStreetName = (tags, preferLocale = 'en') => {
  if (tags.noname === 'yes') return '';
  const localized = tags[`name:${preferLocale}`];
  if (localized && localized.trim()) return localized.trim();
  if (tags.name && tags.name.trim()) return tags.name.trim();
  if (tags.ref && tags.ref.trim()) {
    return tags.ref.trim();
  }
  return '';
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
        structure: "normal",
        name: getStreetName(element.tags, (config.locale || 'en')),
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
  } catch (e) { // falling back to slower but more reliable big-json if files are too big
    console.time(`Writing roads for ${place.name} (${place.code})`);
    console.time(`Writing buildings for ${place.name} (${place.code})`);
    console.time(`Writing places for ${place.name} (${place.code})`);

    const roadsWriteStream = fs.createWriteStream(`./raw_data/${place.code}/roads.geojson`, { encoding: 'utf8' });
    const buildingsWriteStream = fs.createWriteStream(`./raw_data/${place.code}/buildings.json`, { encoding: 'utf8' });
    const placesWriteStream = fs.createWriteStream(`./raw_data/${place.code}/places.json`, { encoding: 'utf8' });

    const roadStringifyStream = createStringifyStream({ body: roadData });
    const buildingsStringifyStream = createStringifyStream({ body: buildingData });
    const placesStringifyStream = createStringifyStream({ body: placesData });

    roadStringifyStream.on('end', () => {
      console.timeEnd(`Writing roads for ${place.name} (${place.code})`);
      roadsWriteStream.close();
    });
    buildingsStringifyStream.on('end', () => {
      console.timeEnd(`Writing buildings for ${place.name} (${place.code})`);
      buildingsWriteStream.close();
    });
    placesStringifyStream.on('end', () => {
      console.timeEnd(`Writing places for ${place.name} (${place.code})`);
      placesWriteStream.close();
    });

    roadStringifyStream.pipe(roadsWriteStream);
    buildingsStringifyStream.pipe(buildingsWriteStream);
    placesStringifyStream.pipe(placesWriteStream);

    console.log(`Done downloading ${place.name} (${place.code}) - DO NOT EXIT THE PROGRAM AS FILES MAY STILL BE GETTING WRITTEN`);
  }
};

if (!fs.existsSync('./raw_data')) fs.mkdirSync('./raw_data');
config.places.forEach((place) => {
  fetchAllData(place);
});
import fs from 'fs';
import config from '../config.js';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ENABLE_DEV_TOOLS = false;

const getProjectPath = (...pathParts) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.join(__dirname, '..', ...pathParts);
};

if (fs.existsSync('./patching_working_directory')) fs.rmSync('./patching_working_directory', { force: true, recursive: true, });
fs.mkdirSync('./patching_working_directory');

const triggerError = (key, secondaryError = null) => {
  const errorMessages = {
    'file-not-found': 'SubwayBuilder-Patcher couldn\'t find a game file that needs to be patched for proper functionality.',
    'code-not-found': 'SubwayBuilder-Patcher couldn\'t find a piece of code within a game file that needs to be patched for proper functionality.',
    'required-map-file-not-found': 'SubwayBuilder-Patcher couldn\'t find a file for one of your maps. Please ensure each of your directories in processed_data/ has a buildings_index.json, demand_data.json, and roads.geojson (and/or the .gz versions of those files).',
  };
  console.error('ERROR:', errorMessages[key]);
  if (secondaryError) console.error(secondaryError);
  console.error('Exiting due to error...');
  process.exit(1);
};

const stringReplaceAt = (string, startIndex, endIndex, replacement) => {
  return string.substring(0, startIndex) + replacement + string.substring(endIndex + 1);
};

console.log('Subway Builder Patcher by Piero Maddaleni');
console.log(`Declared operating system: ${config.platform}`);

// getting the game files over here
if (config.platform == 'linux') {
  console.log('Copying AppImage to working directory');
  fs.cpSync(config.subwaybuilderLocation, getProjectPath('patching_working_directory', 'SB.AppImage'));
  console.log('Extracting AppImage contents')
  fs.chmodSync(getProjectPath('patching_working_directory', 'SB.AppImage'), '777');
  execSync(`"${getProjectPath('patching_working_directory', 'SB.AppImage')}" --appimage-extract`, { cwd: getProjectPath('patching_working_directory') });
} else if (config.platform == 'windows') {
  console.log('Copying install directory to working directory');
  fs.cpSync(config.subwaybuilderLocation, './patching_working_directory/squashfs-root/', { recursive: true });
} else if (config.platform == 'macos') {
  console.log('Copying app contents to working directory');
  fs.cpSync(config.subwaybuilderLocation + '/Contents', './patching_working_directory/squashfs-root/', { recursive: true });
  fs.renameSync('./patching_working_directory/squashfs-root/Resources', './patching_working_directory/squashfs-root/resources');
};

console.log('Extracting asar contents')
execSync(`npx @electron/asar extract "${getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'app.asar')}" "${getProjectPath('patching_working_directory', 'extracted-asar')}"`)

console.log('Locating main.js');
const shouldBeMainJS = getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'main', 'main.js');
console.log('Locating index.js')
const filesInPublicDirectory = fs.readdirSync(getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'public'));
const shouldBeIndexJS = filesInPublicDirectory.filter((fileName) => fileName.startsWith('index-') && fileName.endsWith('.js'));
console.log('Locating GameMain.js')
const shouldBeGameMainJS = filesInPublicDirectory.filter((fileName) => fileName.startsWith('GameMain-') && fileName.endsWith('.js'));

if (shouldBeIndexJS.length == 0 || shouldBeGameMainJS.length == 0) {
  triggerError('file-not-found');
}

if (ENABLE_DEV_TOOLS) {
  if (!fs.existsSync(shouldBeMainJS)) triggerError('file-not-found', 'main.js could not be located in the game files.');
  console.log('Enabling dev tools')
  const originalMainJS = fs.readFileSync(shouldBeMainJS, {encoding: 'utf8'});
  const replacedMainJS = originalMainJS.replace('isDev || process["env"]["DEBUG_PROD"]', 'isDev || process["env"]["DEBUG_PROD"] || true');
  fs.writeFileSync(shouldBeMainJS, replacedMainJS, {encoding: 'utf8'});
}

console.log('Extracting existing list of cities')
const indexJSContents = fs.readFileSync(getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'public', shouldBeIndexJS[0]), { encoding: 'utf8' });
const startOfCitiesArea = indexJSContents.indexOf('const cities = [{') + 'const cities = '.length; // will give us the start of the array
const endOfCitiesArea = indexJSContents.indexOf('}];', startOfCitiesArea) + 2;
if (startOfCitiesArea == -1 || endOfCitiesArea == -1) triggerError('code-not-found', 'The list of cities could not be located.');

const existingListOfCities = JSON.parse(indexJSContents.substring(startOfCitiesArea, endOfCitiesArea));
console.log('Modifying existing list of cities and writing placeholder city maps');
existingListOfCities.push(...config.places.map((place) => {
  fs.cpSync(getProjectPath('placeholder_mapimage.svg'), getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'city-maps', `${place.code.toLowerCase()}.svg`));
  return {
    name: place.name,
    code: place.code,
    description: place.description,
    population: place.population,
    initialViewState: {
      zoom: 13.5,
      latitude: (place.bbox[1] + place.bbox[3]) / 2,
      longitude: (place.bbox[0] + place.bbox[2]) / 2,
      bearing: 0,
    }
  }
}));
console.log('Writing to index.js')
const indexAfterCitiesMod = stringReplaceAt(indexJSContents, startOfCitiesArea, endOfCitiesArea, JSON.stringify(existingListOfCities) + ';');
fs.writeFileSync(getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'public', shouldBeIndexJS[0]), indexAfterCitiesMod, { 'encoding': 'utf-8' });

console.log('Extracting existing map config')
const gameMainJSContents = fs.readFileSync(getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'public', shouldBeGameMainJS[0]), { encoding: 'utf8' });
const startOfMapConfig = gameMainJSContents.indexOf('const sources = {') + 'const sources = '.length; // will give us the start of the config
const endOfMapConfig = gameMainJSContents.indexOf('const layers', startOfMapConfig) - 1;
if (startOfMapConfig == -1 || endOfMapConfig == -1) triggerError('code-not-found', 'The original map config could not be located.');
const existingMapConfig = gameMainJSContents.substring(startOfMapConfig, endOfMapConfig);
console.log('Modifying map config');
const newMapConfig = existingMapConfig
  .replaceAll(/\[(tilesUrl|foundationTilesUrl)\]/g, JSON.stringify([
    'https://v4mapa.piemadd.com/20251013/{z}/{x}/{y}.mvt',
    'https://v4mapb.piemadd.com/20251013/{z}/{x}/{y}.mvt',
    'https://v4mapc.piemadd.com/20251013/{z}/{x}/{y}.mvt',
    'https://v4mapd.piemadd.com/20251013/{z}/{x}/{y}.mvt',
  ]))
  .replaceAll('maxzoom: 16', 'maxzoom: 15');
const gameMainAfterMapConfigMod = stringReplaceAt(gameMainJSContents, startOfMapConfig, endOfMapConfig, newMapConfig);

console.log('Modifying map layers')
// doing parks coloring
const startOfParksMapConfig = gameMainAfterMapConfigMod.search(/{\n\s*id:\s*"parks-large",/);
const endOfParksMapConfig = gameMainAfterMapConfigMod.search(/{\n\s*id:\s*"airports/, startOfParksMapConfig) - 1;
if (startOfParksMapConfig == -1 || endOfParksMapConfig == -1) triggerError('code-not-found', 'The map styling for parks could not be located.');
let parksMapConfig = gameMainAfterMapConfigMod.substring(startOfParksMapConfig, endOfParksMapConfig);
const originalFilters = parksMapConfig.match(/\["[<>=]{1,2}",\s+\["get",\s+"area"\],\s+[0-9e]+\]/g);
originalFilters.forEach((filter) => {
  if (''.includes('<')) return; // we're only doing the big park, dont @ me (the data for park sizes isnt in my tiles)
  parksMapConfig = parksMapConfig.replace(filter, `["==", ["get", "kind"], "park"]`);
});
parksMapConfig = parksMapConfig.replaceAll(`"source-layer": "parks"`, `"source-layer": "landuse"`);
const gameMainAfterParksMapConfigMod = stringReplaceAt(gameMainAfterMapConfigMod, startOfParksMapConfig, endOfParksMapConfig, parksMapConfig);
// end of maps coloring

console.log('Writing to GameMain.js')
fs.writeFileSync(getProjectPath('patching_working_directory', 'extracted-asar', 'dist', 'renderer', 'public', shouldBeGameMainJS[0]), gameMainAfterParksMapConfigMod, { 'encoding': 'utf-8' });

// i can do this programmatically but it was seemingly async, which I can't deal with rn
console.log('Repacking asar contents');
execSync(`npx @electron/asar pack "${getProjectPath('patching_working_directory', 'extracted-asar')}" "${getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'app.asar')}"`)

console.log('Copying over maps and compressing (if needed)');
config.places.forEach((place) => {
  fs.cpSync(
    getProjectPath('processed_data', place.code),
    getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'data', place.code),
    { recursive: true }
  );

  const listOfPlaceFiles = fs.readdirSync(getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'data', place.code));

  //guh
  let hasBuildings = false;
  let hasDemand = false;
  let hasRoads = false;

  // checking to make sure we have everything we need
  listOfPlaceFiles.forEach((file) => {
    if (file.startsWith('buildings')) hasBuildings = true;
    if (file.startsWith('demand')) hasDemand = true;
    if (file.startsWith('roads')) hasRoads = true;
  });

  if (!hasBuildings) triggerError('required-map-file-not-found', 'Missing file: buildings_index.json OR buildings_index.json.gz (only one is required)');
  if (!hasDemand) triggerError('required-map-file-not-found', 'Missing file: demand_data.json OR buildings_index.json.gz (only one is required)');
  if (!hasRoads) triggerError('required-map-file-not-found', 'Missing file: roads.geojson OR buildings_index.geojson.gz (only one is required)');

  // actually zipping
  listOfPlaceFiles.forEach((file) => {
    if (!file.endsWith('.gz')) {
      execSync(`gzip -f "${getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'data', place.code, file)}"`);
    }
  });
});

// finishing up
if (config.platform == 'linux') {
  console.log('Creating new AppImage');
  fs.chmodSync(getProjectPath('appimagetool.AppImage'), '777');
  fs.renameSync(getProjectPath('patching_working_directory', 'squashfs-root'), getProjectPath('patching_working_directory', 'sbp.AppDir'), { recursive: true, force: true })
  execSync(`"${getProjectPath('appimagetool.AppImage')}" "${getProjectPath('patching_working_directory', 'sbp.AppDir')}"`, { cwd: getProjectPath() });
} else if (config.platform == 'windows') {
  console.log('Copying final game directory to root');
  fs.cpSync(getProjectPath('patching_working_directory', 'squashfs-root'), getProjectPath('Subway_Builder'), { recursive: true });
} else if (config.platform == 'macos') {
  console.log('Patching existing app by copying it and replacing only the modified files...');
  const originalAppPath = '/Applications/Subway Builder.app';
  const patchedAppPath = getProjectPath('Subway_Builder_Patched.app');

  if (fs.existsSync(patchedAppPath)) {
    console.log('Removing old patched app directory...');
    fs.rmSync(patchedAppPath, { recursive: true, force: true });
  }
  console.log(`Copying 'Subway Builder.app' from /Applications using ditto to not break signature...`);
  try {
    execSync(`ditto "${originalAppPath}" "${patchedAppPath}"`);
  } catch (error) {
    console.error('ERROR: Failed to copy the application. Please ensure "Subway Builder.app" is in your /Applications folder.');
    console.error(error);
    process.exit(1);
  }

  console.log('Replacing app.asar...');
  const patchedAsarPath = getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'app.asar');
  const targetAsarPath = path.join(patchedAppPath, 'Contents', 'Resources', 'app.asar');
  fs.cpSync(patchedAsarPath, targetAsarPath);

  console.log('Copying new map data...');
  config.places.forEach((place) => {
    const sourceMapDataPath = getProjectPath('patching_working_directory', 'squashfs-root', 'resources', 'data', place.code);
    const targetMapDataPath = path.join(patchedAppPath, 'Contents', 'Resources', 'data', place.code);
    if (!fs.existsSync(path.join(patchedAppPath, 'Contents', 'Resources', 'data'))) {
      fs.mkdirSync(path.join(patchedAppPath, 'Contents', 'Resources', 'data'));
    }
    console.log(`Adding data for ${place.name}`);
    fs.cpSync(sourceMapDataPath, targetMapDataPath, { recursive: true });
  });

  console.log('Clearing extended attributes');
  try {
    execSync(`xattr -cr "${patchedAppPath}"`);
  } catch (error) {
    console.warn('Warning: Failed to clear extended attributes.');
    console.warn(error.message);
  }

  console.log('Applying ad-hoc signature to the app');
  try {
    execSync(`codesign --force --deep -s - "${patchedAppPath}"`);
  } catch (error) {
    console.error('ERROR: Failed to sign the application.');
    console.error('Please ensure Xcode Command Line Tools are installed (run: xcode-select --install)');
    console.error(error);
    process.exit(1);
  }

  console.log(`Patched Game is ready at: ${patchedAppPath}`);
  console.log('NOTE: The patched Game is no longer signed by a dev certificate. You may need to right-click > "Open" to run it the first time since you signed it "yourself" :)');
};

console.log('Cleaning up');
console.log('All done!');
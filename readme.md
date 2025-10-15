# SubwayBuilder Patcher

Self explanatory title. Patches other cities into subway builder. You need to own the game already and have it on your machine. I might extend this to add features and such to subwaybuilder. I don't know. Its 9pm on a thursday as I type this. I don't even know what I'm having for lunch tomorrow; I definitely don't know where this project will be within a week.

## Support
This tool will patch an appimage (linux) or create a modified version of the install directory. I would add support for macos, but the best I can do is generate a folder that macos users *should* be able to bring into their install folder. I have no clue though. The vodka lemonades are speaking to me.

## Limitations
I'm just getting all of the data from OSM. Job and population data are incredibly limited due to this. Everything else is fine. Don't worry about it.

## Downloading
Git, wow. You know the drill. Or maybe you don't. I am assuming you have some experience with git and nodejs to use this tool. I'm sorry if you dont (I'll try to make an in depth video tutorial at some point on how to install node and run this if you aren't *super* technical).

1. `git clone https://github.com/piemadd/subwaybuilder-patcher`
2. cd `subwaybuilder-patcher`
3. `npm install`

Additionally, the following tools are required to be installed:
- gzip
- appimagetool (LINUX ONLY)
  - Go [here](https://github.com/AppImage/appimagetool/releases/tag/continuous)
  - Download the latest version for your chip type (most likely `appimagetool-x86_64.AppImage`)
  - Rename the file to `appimagetool.AppImage` and copy it here


## Config
Well, the program needs to know what cities you want to download and patch in. Gotta configure that. To do so, you can modify `config.js`. Within this file, you need to add `places`. Most of this is self explanatory I want to say. Code (ie the city's main airport code), Name, Description, and Bounding Box. To get a valid bounding box:

1. Go to [bboxfinder.com](https://bboxfinder.com/).
2. Select your city with the tools in the top left.  
  a. For the simplest, just press the rectangle and drag.  
  b. You can have multiple combined shapes and arbitrary polygons. Go fucking wild.
3. Select the text next to 'Box' at the bottom.  
  a. Should look like this: `-79.405575,43.641169,-79.363003,43.663029`
4. Paste that into the `bbox` field for this `place` in your `config.js`.

Additionally, you need to insert the location of your SubwayBuilder install (if on linux, the appimage location, if on windows, the install directory) and you need to specify what operating system you're using (either windows or linux).

There are valid sample configurations for windows and linux at `config_windows.js` and `config_linux.js` respectively.

This is a valid `config.js`:
```js
const config = {
  "subwaybuilderLocation": "./Downloads/Subway-Builder/Subway-Builder.AppImage",
  "places": [
    {
      "code": "YYZ", // not sure if required, but I would use all caps for the code
      "name": "Toronto",
      "description": "sideways chicago. da windy city babayyyyy",
      "bbox": [-79.405575, 43.641169, -79.363003, 43.663029],
      "population": 2700000, // this doesn't really matter, it just pops up on the map selection screen
    }
  ],
  "platform": "linux"
};

export default config;
```

## Running Scripts
There are many scripts. Great scripts. Wonderful scripts. You don't need to run them all, but you certainly can.

### Download Data
> `node ./scripts/download_data.js`

Takes the array of places within `config.js` and downloads OSM data from the [Overpass API](https://overpass-api.de/).

### Process Data
> `node ./scripts/process_data.js`

Processes the previously downloaded data into folders that SubwayBuilder can understand. These will be located in the folder named `processed_data/`.

### Patch Game
> `node ./scripts/patch_game.js`

Patches the places into an appimage (linux) or the install folder (windows). In both cases, the patched version of the game will appear here under a folder named `subwaybuilder-patched-sbp/`. Your original installation will not be overwritten.

**NOTE**: If you already have a built map, you can skip the first two scripts and place your built map within `processed_data/`. You ***will still need to*** create a valid configuration for this map within `config.js`, but can avoid having to run the downloading and processing scripts. After doing so, you can run the Patch Game script as normal.

---

ok thats all thanks for reading this readme

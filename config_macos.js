const config = {
  "subwaybuilderLocation": "/Applications/Subway Builder.app", // appimage location image on linux, .app location on mac or install directory on windows (something like C:\Users\[username]\AppData\Local\Programs\Subway Builder)
  "places": [
    {
      "code": "YYZ",
      "name": "Toronto",
      "description": "sideways chicago. da windy city babayyyyy",
      "bbox": [-79.671478, 43.571686, -79.232368, 43.788693], // -79.454498,43.624458,-79.310818,43.680412
      "population": 2700000,
    },
  ],
  "platform": "macos" // either 'linux' or 'windows' or 'macos'
};

export default config;
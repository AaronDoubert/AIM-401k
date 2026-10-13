#!/usr/bin/env node
// Generates src/core/usmap.data.ts (the offline USA map used by the War Room).
// Run once at authoring time; the output is checked in. Nothing here ships.
//
//   npm i --prefix /tmp/usmap-gen us-atlas topojson-client topojson-simplify d3-geo
//   USMAP_MODULES=/tmp/usmap-gen node scripts/make-usmap.mjs      # or pass the dir as argv[2]
//
// These packages are deliberately NOT in package.json. USMAP_WEIGHT tunes simplification.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const dir = resolve(process.env.USMAP_MODULES || process.argv[2] || "/tmp/usmap-gen");
const req = createRequire(`${dir}/package.json`);
const topo = req("topojson-client");
const simp = req("topojson-simplify");
const { geoAlbersUsa, geoPath } = req("d3-geo");
const atlas = JSON.parse(readFileSync(req.resolve("us-atlas/states-albers-10m.json"), "utf8"));

const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const path = geoPath().digits(1);

// Simplify the topology (shared arcs, so borders stay watertight), then emit paths.
const weight = Number(process.env.USMAP_WEIGHT || 3);
const t = simp.simplify(simp.presimplify(atlas), weight);
const nation = path(topo.mesh(t, t.objects.nation));
const borders = path(topo.mesh(t, t.objects.states, (a, b) => a !== b));

const project = (lon, lat) => {
  const p = proj([lon, lat]);
  return p ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : null;
};

// [code, name, lat, lon] interior label points (hand-picked for odd shapes).
const STATE_PTS = [
  ["AL", "Alabama", 32.8, -86.8], ["AK", "Alaska", 64.2, -152.5], ["AZ", "Arizona", 34.3, -111.7],
  ["AR", "Arkansas", 34.9, -92.4], ["CA", "California", 37.2, -119.6], ["CO", "Colorado", 39.0, -105.55],
  ["CT", "Connecticut", 41.6, -72.7], ["DE", "Delaware", 39.0, -75.5], ["DC", "District of Columbia", 38.9, -77.03],
  ["FL", "Florida", 28.4, -82.0], ["GA", "Georgia", 32.7, -83.4], ["HI", "Hawaii", 20.8, -156.3],
  ["ID", "Idaho", 44.4, -114.6], ["IL", "Illinois", 40.0, -89.2], ["IN", "Indiana", 39.9, -86.3],
  ["IA", "Iowa", 42.0, -93.5], ["KS", "Kansas", 38.5, -98.3], ["KY", "Kentucky", 37.5, -85.3],
  ["LA", "Louisiana", 31.0, -92.2], ["ME", "Maine", 45.3, -69.2], ["MD", "Maryland", 39.05, -76.8],
  ["MA", "Massachusetts", 42.3, -72.0], ["MI", "Michigan", 43.6, -84.7], ["MN", "Minnesota", 46.0, -94.3],
  ["MS", "Mississippi", 32.7, -89.7], ["MO", "Missouri", 38.4, -92.5], ["MT", "Montana", 47.0, -109.6],
  ["NE", "Nebraska", 41.5, -99.8], ["NV", "Nevada", 39.3, -116.6], ["NH", "New Hampshire", 43.7, -71.6],
  ["NJ", "New Jersey", 40.1, -74.5], ["NM", "New Mexico", 34.4, -106.1], ["NY", "New York", 42.9, -75.5],
  ["NC", "North Carolina", 35.5, -79.4], ["ND", "North Dakota", 47.45, -100.5], ["OH", "Ohio", 40.3, -82.8],
  ["OK", "Oklahoma", 35.5, -97.5], ["OR", "Oregon", 43.9, -120.6], ["PA", "Pennsylvania", 40.9, -77.8],
  ["PR", "Puerto Rico", 18.2, -66.5], ["RI", "Rhode Island", 41.7, -71.5], ["SC", "South Carolina", 33.9, -80.9],
  ["SD", "South Dakota", 44.4, -100.2], ["TN", "Tennessee", 35.8, -86.3], ["TX", "Texas", 31.4, -99.3],
  ["UT", "Utah", 39.3, -111.7], ["VT", "Vermont", 44.0, -72.7], ["VA", "Virginia", 37.5, -78.8],
  ["WA", "Washington", 47.4, -120.5], ["WV", "West Virginia", 38.6, -80.6], ["WI", "Wisconsin", 44.6, -89.9],
  ["WY", "Wyoming", 43.0, -107.55],
];

// [name, state, lat, lon]
const CITY_PTS = [
  ["New York", "NY", 40.71, -74.01], ["Brooklyn", "NY", 40.68, -73.94], ["Los Angeles", "CA", 34.05, -118.24],
  ["Chicago", "IL", 41.88, -87.63], ["Houston", "TX", 29.76, -95.37], ["Phoenix", "AZ", 33.45, -112.07],
  ["Philadelphia", "PA", 39.95, -75.17], ["San Antonio", "TX", 29.42, -98.49], ["San Diego", "CA", 32.72, -117.16],
  ["Dallas", "TX", 32.78, -96.8], ["San Jose", "CA", 37.34, -121.89], ["Austin", "TX", 30.27, -97.74],
  ["Jacksonville", "FL", 30.33, -81.66], ["Fort Worth", "TX", 32.76, -97.33], ["Columbus", "OH", 39.96, -83.0],
  ["Charlotte", "NC", 35.23, -80.84], ["San Francisco", "CA", 37.77, -122.42], ["Indianapolis", "IN", 39.77, -86.16],
  ["Seattle", "WA", 47.61, -122.33], ["Denver", "CO", 39.74, -104.99], ["Washington", "DC", 38.91, -77.04],
  ["Boston", "MA", 42.36, -71.06], ["El Paso", "TX", 31.76, -106.49], ["Nashville", "TN", 36.16, -86.78],
  ["Detroit", "MI", 42.33, -83.05], ["Oklahoma City", "OK", 35.47, -97.52], ["Portland", "OR", 45.52, -122.68],
  ["Las Vegas", "NV", 36.17, -115.14], ["Memphis", "TN", 35.15, -90.05], ["Louisville", "KY", 38.25, -85.76],
  ["Baltimore", "MD", 39.29, -76.61], ["Milwaukee", "WI", 43.04, -87.91], ["Albuquerque", "NM", 35.08, -106.65],
  ["Tucson", "AZ", 32.22, -110.97], ["Fresno", "CA", 36.74, -119.79], ["Sacramento", "CA", 38.58, -121.49],
  ["Mesa", "AZ", 33.42, -111.83], ["Kansas City", "MO", 39.1, -94.58], ["Atlanta", "GA", 33.75, -84.39],
  ["Omaha", "NE", 41.26, -95.93], ["Colorado Springs", "CO", 38.83, -104.82], ["Raleigh", "NC", 35.78, -78.64],
  ["Miami", "FL", 25.76, -80.19], ["Long Beach", "CA", 33.77, -118.19], ["Virginia Beach", "VA", 36.85, -75.98],
  ["Oakland", "CA", 37.8, -122.27], ["Minneapolis", "MN", 44.98, -93.27], ["Tulsa", "OK", 36.15, -95.99],
  ["Tampa", "FL", 27.95, -82.46], ["Arlington", "VA", 38.88, -77.1], ["New Orleans", "LA", 29.95, -90.07],
  ["Wichita", "KS", 37.69, -97.34], ["Cleveland", "OH", 41.5, -81.69], ["Bakersfield", "CA", 35.37, -119.02],
  ["Honolulu", "HI", 21.31, -157.86], ["Anchorage", "AK", 61.22, -149.9], ["Aurora", "CO", 39.73, -104.83],
  ["Anaheim", "CA", 33.84, -117.91], ["Santa Ana", "CA", 33.75, -117.87], ["Irvine", "CA", 33.68, -117.83],
  ["Costa Mesa", "CA", 33.64, -117.92], ["El Segundo", "CA", 33.92, -118.42], ["Santa Monica", "CA", 34.02, -118.5],
  ["Pasadena", "CA", 34.15, -118.14], ["Culver City", "CA", 34.02, -118.4], ["Burbank", "CA", 34.18, -118.31],
  ["Torrance", "CA", 33.84, -118.34], ["Palo Alto", "CA", 37.44, -122.14], ["Mountain View", "CA", 37.39, -122.08],
  ["Sunnyvale", "CA", 37.37, -122.04], ["Santa Clara", "CA", 37.35, -121.96], ["Cupertino", "CA", 37.32, -122.03],
  ["Menlo Park", "CA", 37.45, -122.18], ["Redwood City", "CA", 37.49, -122.24], ["San Mateo", "CA", 37.56, -122.32],
  ["Fremont", "CA", 37.55, -121.99], ["Berkeley", "CA", 37.87, -122.27], ["Santa Cruz", "CA", 36.97, -122.03],
  ["Stockton", "CA", 37.96, -121.29], ["Riverside", "CA", 33.95, -117.4], ["Carlsbad", "CA", 33.16, -117.35],
  ["Redmond", "WA", 47.67, -122.12], ["Bellevue", "WA", 47.61, -122.2], ["Kirkland", "WA", 47.68, -122.21],
  ["Tacoma", "WA", 47.25, -122.44], ["Spokane", "WA", 47.66, -117.43], ["Boise", "ID", 43.62, -116.2],
  ["Eugene", "OR", 44.05, -123.09], ["Salem", "OR", 44.94, -123.04], ["Hillsboro", "OR", 45.52, -122.99],
  ["Beaverton", "OR", 45.49, -122.8], ["Salt Lake City", "UT", 40.76, -111.89], ["Provo", "UT", 40.23, -111.66],
  ["Lehi", "UT", 40.39, -111.85], ["Boulder", "CO", 40.01, -105.27], ["Fort Collins", "CO", 40.59, -105.08],
  ["Littleton", "CO", 39.61, -105.02], ["Scottsdale", "AZ", 33.49, -111.93], ["Tempe", "AZ", 33.43, -111.94],
  ["Chandler", "AZ", 33.3, -111.84], ["Santa Fe", "NM", 35.69, -105.94], ["Los Alamos", "NM", 35.88, -106.3],
  ["Reno", "NV", 39.53, -119.81], ["Henderson", "NV", 36.04, -114.98], ["Plano", "TX", 33.02, -96.7],
  ["Irving", "TX", 32.81, -96.95], ["Frisco", "TX", 33.15, -96.82], ["Richardson", "TX", 32.95, -96.73],
  ["Round Rock", "TX", 30.51, -97.68], ["Corpus Christi", "TX", 27.8, -97.4], ["Lubbock", "TX", 33.58, -101.86],
  ["Huntsville", "AL", 34.73, -86.59], ["Birmingham", "AL", 33.52, -86.8], ["Mobile", "AL", 30.69, -88.04],
  ["Montgomery", "AL", 32.37, -86.3], ["Jackson", "MS", 32.3, -90.18], ["Baton Rouge", "LA", 30.45, -91.15],
  ["Little Rock", "AR", 34.75, -92.29], ["Bentonville", "AR", 36.37, -94.21], ["Orlando", "FL", 28.54, -81.38],
  ["Tallahassee", "FL", 30.44, -84.28], ["Fort Lauderdale", "FL", 26.12, -80.14], ["Melbourne", "FL", 28.08, -80.61],
  ["Savannah", "GA", 32.08, -81.09], ["Charleston", "SC", 32.78, -79.93], ["Columbia", "SC", 34.0, -81.03],
  ["Greenville", "SC", 34.85, -82.4], ["Durham", "NC", 35.99, -78.9], ["Chapel Hill", "NC", 35.91, -79.06],
  ["Cary", "NC", 35.79, -78.78], ["Greensboro", "NC", 36.07, -79.79], ["Richmond", "VA", 37.54, -77.44],
  ["Reston", "VA", 38.97, -77.34], ["McLean", "VA", 38.93, -77.18], ["Herndon", "VA", 38.97, -77.39],
  ["Alexandria", "VA", 38.8, -77.05], ["Fairfax", "VA", 38.85, -77.31], ["Tysons", "VA", 38.92, -77.22],
  ["Norfolk", "VA", 36.85, -76.29], ["Bethesda", "MD", 38.98, -77.1], ["Rockville", "MD", 39.08, -77.15],
  ["Columbia", "MD", 39.2, -76.86], ["Annapolis", "MD", 38.98, -76.49], ["Wilmington", "DE", 39.74, -75.55],
  ["Pittsburgh", "PA", 40.44, -80.0], ["Harrisburg", "PA", 40.27, -76.88], ["Princeton", "NJ", 40.36, -74.67],
  ["Newark", "NJ", 40.74, -74.17], ["Jersey City", "NJ", 40.73, -74.08], ["Hoboken", "NJ", 40.74, -74.03],
  ["Stamford", "CT", 41.05, -73.54], ["Hartford", "CT", 41.76, -72.69], ["New Haven", "CT", 41.31, -72.92],
  ["Providence", "RI", 41.82, -71.41], ["Cambridge", "MA", 42.37, -71.11], ["Waltham", "MA", 42.38, -71.24],
  ["Burlington", "VT", 44.48, -73.21], ["Manchester", "NH", 42.99, -71.46], ["Portland", "ME", 43.66, -70.26],
  ["Albany", "NY", 42.65, -73.76], ["Buffalo", "NY", 42.89, -78.88], ["Rochester", "NY", 43.16, -77.61],
  ["Syracuse", "NY", 43.05, -76.15], ["Ann Arbor", "MI", 42.28, -83.74], ["Grand Rapids", "MI", 42.96, -85.67],
  ["Cincinnati", "OH", 39.1, -84.51], ["Dayton", "OH", 39.76, -84.19], ["Madison", "WI", 43.07, -89.4],
  ["St. Paul", "MN", 44.95, -93.09], ["Des Moines", "IA", 41.59, -93.62], ["St. Louis", "MO", 38.63, -90.2],
  ["Lincoln", "NE", 40.81, -96.7], ["Fargo", "ND", 46.88, -96.79], ["Sioux Falls", "SD", 43.55, -96.73],
  ["Lexington", "KY", 38.04, -84.5], ["Knoxville", "TN", 35.96, -83.92], ["Chattanooga", "TN", 35.05, -85.31],
  ["Oak Ridge", "TN", 36.01, -84.27], ["Charleston", "WV", 38.35, -81.63], ["Evansville", "IN", 37.97, -87.57],
  ["Fort Wayne", "IN", 41.08, -85.14], ["Naperville", "IL", 41.79, -88.15], ["Schaumburg", "IL", 42.03, -88.08],
  ["San Juan", "PR", 18.47, -66.11],
];

const STATES = {};
for (const [code, name, lat, lon] of STATE_PTS) {
  const p = project(lon, lat);
  if (p) STATES[code] = { name, x: p[0], y: p[1] };
  else console.warn("no projection for state", code);
}
const cities = [];
for (const [name, st, lat, lon] of CITY_PTS) {
  const p = project(lon, lat);
  if (p) cities.push([name, st, p[0], p[1]]);
  else console.warn("dropped city", name, st);
}

const out = `// GENERATED by scripts/make-usmap.mjs. Do not edit by hand.
// Sources: us-atlas states-albers-10m (ISC license), derived from US Census Bureau
// cartographic boundaries (public domain), simplified with topojson-simplify.
// State and city coordinates are hand-listed lat/lon, projected with
// d3 geoAlbersUsa().scale(1300).translate([487.5, 305]). Fully offline.

export const MAP_VIEWBOX = "0 0 975 610";

export const NATION_PATH = ${JSON.stringify(nation)};

export const STATE_BORDERS_PATH = ${JSON.stringify(borders)};

export const STATES: Record<string, { name: string; x: number; y: number }> = ${JSON.stringify(STATES)};

export const CITIES: readonly (readonly [name: string, state: string, x: number, y: number])[] = ${JSON.stringify(cities)};
`;
writeFileSync("src/core/usmap.data.ts", out);
console.log("wrote", out.length, "bytes;", cities.length, "cities;", Object.keys(STATES).length, "states");

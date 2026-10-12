// Firefox exposes the promise-based `browser` namespace. Chromium MV3 exposes
// a promise-capable `chrome`. Using this alias keeps the extension loadable in
// both (handy for automated testing in Chromium).
declare const chrome: typeof browser | undefined;

export const api: typeof browser =
  typeof browser !== "undefined" ? browser : (chrome as typeof browser);

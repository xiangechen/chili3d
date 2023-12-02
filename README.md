# Chili3D

[Chili3D](https://chili3d.com) is a fast, web-based 3D CAD program that works in any modern browser. Built with TypeScript, Three.js, and Opencascade.js.

![screenshot](screenshots/screenshot.png)

## WARNING

Chili3D is still in the very early stages of development. APIs can and will change (now is the time to make suggestions!). Important features are missing. Documentation is sparse. Please don't build any serious projects in Chili3D unless you are prepared to be broken by API changes constantly.

## Features

The app hosted at chili3d.com is a minimal showcase of what you can build with chili3d. Its features:

-   Open-source (https://github.com/xiangechen/chili3d.git).
-   Localization (i18n) support.
-   Export to STEP, IGES, BREP...
-   Open format - export document as an .cd json file.
-   Snap and Track.
-   Wide range of tools - rectangle, circle, line, box, prism, sweep...
-   Undo / Redo.
-   Local-first support (save to the browser).

## How to Use

This project requires Node.js to be installed.

```bash
$ git clone https://github.com/xiangechen/chili3d.git
$ cd chili3d
$ npm i
$ npm run dev
```

Then open http://localhost:8080/ to use Chili3D.

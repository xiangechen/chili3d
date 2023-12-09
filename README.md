# Chili3D

[Chili3D](https://chili3d.com) is an open source 3D CAD software that runs in any modern web browser. It is built with TypeScript and uses OpenCascade and Three.js for 3D modeling and rendering. Chili3D offers a simple and user-friendly interface that allows you to easily create and modify 3D models.

![screenshot](screenshots/screenshot.png)

## Features

-   Open-source (https://github.com/xiangechen/chili3d.git).
-   Runs on modern web browsers (https://chili3d.com).
-   Localization (i18n) support.
-   Simple and intuitive user interface.
-   Highly flexible hierarchical organization of models.
-   Wide range of tools - rectangle, circle, line, box, prism, sweep...
-   Import and export STEP, IGES, BREP...
-   Snap and Track.
-   Undo / Redo.
-   Local-first support (save to the browser).
-   Open format - save as an .cd json file.

## How to Use

This project requires Node.js to be installed.

```bash
$ git clone https://github.com/xiangechen/chili3d.git
$ cd chili3d
$ npm i
$ npm run dev
```

Then open http://localhost:8080/ to use Chili3D.

## WARNING

Chili3D is still in the very early stages of development. APIs can and will change (now is the time to make suggestions!). Important features are missing. Documentation is sparse. Please don't build any serious projects in Chili3D unless you are prepared to be broken by API changes constantly.

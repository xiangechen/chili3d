# Chili3D

Chili3D is a fast, web-based 3D CAD program that works in any modern browser. Built with TypeScript, Three.js, and Opencascade.js.

## WARNING

Chili3D is still in the very early stages of development. APIs can and will change (now is the time to make suggestions!). Important features are missing. Documentation is sparse. Please don't build any serious projects in Chili3D unless you are prepared to be broken by API changes constantly.

## Features

### Snap and tracking

Can snap to circle center, endpoint, midpoint, intersection and perpendicular point. Tracks the x, y and z axes as well as any polar axis in the working plane.
![snap](screenshots/snap.gif)

### Group

![group](screenshots/group.gif)

### Properties

![group](screenshots/property.gif)

### Undo redo

![undo](screenshots/undo.gif)

### Multilingual

Support for both English and Simplified Chinese languages.

## How to Use

This project requires Node.js to be installed.

```bash
$ git clone https://github.com/xiangechen/chili3d.git
$ cd chili3d
$ npm i
$ npm run dev
```

Then open http://localhost:8080/ to use Chili3D.

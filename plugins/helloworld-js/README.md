# Chili3D js Demo Plugin

A demonstration plugin for Chili3D showing the capabilities of the plugin system.

## Features

- **Hello World Command**: A simple command that displays a greeting message
- **Ribbon Integration**: Adds a button to the Tools tab
- **i18n Support**: Supports English and Chinese (Simplified)

## Project Structure

```
helloworld-js/
├── manifest.json          # Plugin manifest with metadata
├── package.json           # NPM configuration
├── README.md              # This file
├── src/
│   ├── extension.js       # Plugin main class
└── icons/
    └── hello.svg          # Command icon (optional)
```

## Development

Package the plugin (creates .chiliplugin file):

```bash
npm run package
```

The packaging script is cross-platform and works on both Windows (PowerShell) and macOS/Linux.

## Installation

Drag and drop the .chiliplugin file into Chili3D.

# Demo Plugin for Chili3D

Change the importMap.json file to point to plugins server(http://localhost:88686), e.g.:
```json
{
    "imports": {
        "module1": "http://localhost:8686/src/module1.js",
        "module2": "http://localhost:8686/src/module2.js"
    }
}
```

To run the plugin, you need to start the chili3d server: at the root of the chili3d folder, run: `npm run start`. Then, start the plugin server: at the root of the plugin folder, run: `npm run preview`. The plugin server will start on port 8686. The plugin will be available at http://localhost:8080?plugin=http://localhost:8686.
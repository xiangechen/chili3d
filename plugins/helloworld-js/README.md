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

## Installation

Drag and drop the .chiliplugin file into Chili3D.
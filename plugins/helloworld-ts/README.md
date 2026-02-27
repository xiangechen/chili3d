# Chili3D Demo Plugin

A demonstration plugin for Chili3D showing the capabilities of the plugin system.

## Features

- **Hello World Command**: A simple command that displays a greeting message
- **Ribbon Integration**: Adds a button to the Tools tab
- **i18n Support**: Supports English and Chinese (Simplified)

## Project Structure

```
helloworld-ts/
├── manifest.json          # Plugin manifest with metadata
├── package.json           # NPM configuration
├── tsconfig.json          # TypeScript configuration
├── README.md              # This file
├── src/
│   ├── index.ts       # Plugin main class
│   └── commands/
│       └── hello.ts       # Hello World command
└── icons/
    └── hello.svg          # Command icon (optional)
```

## Development

1. Install dependencies:
```bash
npm install
```

2. Build the plugin:
```bash
npm run build
```

3. Package the plugin (creates .chiliplugin file):
```bash
npm run package
```

The packaging script is cross-platform and works on both Windows (PowerShell) and macOS/Linux.

## Installation

Drag and drop the `.chiliplugin` file into Chili3D.

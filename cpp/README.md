# chili3d's WebAssembly Module

## Clone and install all dependencies

When compiling for the first time, or if the build directory has been deleted or dependencies have been updated, please execute this command

```bash
npm run setup:wasm
```

If you see **Setup complete**, it means it was successful. Otherwise, please check the logs and try again.

## Compile

To build the current project, please execute

```bash
npm run build:wasm
```

After the compilation is completed, the target will be copied to the **packages/chili-wasm/lib** directory.

# chili3d's WebAssembly Module

## Clone and install all dependencies

When compiling for the first time, deleting the build directory, or needing to update dependencies, execute

```bash
npm run setup:wasm
```

Running this command will clone emscripten and install all dependencies, while also compiling libraries such as opencascade into static libraries. Note: This command will take a significant amount of time. If you see **Setup complete**, it means it was successful. Otherwise, please check the logs and try running again.

## Compile

To build the current project, please execute

```bash
# The reason for executing mv node_modules is to resolve a conflict with WebXR when generating .d.ts files. Are there any other solutions?

mv node_modules node_modules_backup
npm run build:wasm
mv node_modules_backup node_modules
```

After the compilation is completed, the target will be copied to the **packages/chili-wasm/lib** directory.

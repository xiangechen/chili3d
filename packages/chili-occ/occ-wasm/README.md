# `opencascadejs`

An opencascadejs build containing only the APIs necessary to run chili.

## Usage

```shell
podman run -it --rm -v $(pwd):/src -u $(id -u):$(id -g) docker.io/donalffons/opencascade.js build_config.yml
```

## Link

[Creating Custom Builds](https://ocjs.org/docs/app-dev-workflow/custom-builds)
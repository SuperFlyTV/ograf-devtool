# OGraf Devtool

<img src="docs/logo/ograf-logo-colour.svg" width="300"/>

_This tool is running at [https://ograf-devtool.superfly.tv](https://ograf-devtool.superfly.tv)_

This is a tool to help with developing <b>[OGraf](https://ograf.ebu.io/) Graphics</b>.

## Main features

- Loads and displays OGraf Graphics directly from your local hard drive.
- Runs various checks on the OGraf Graphics to find common mistakes that makes them non-compliant with the OGraf specification.
- Control GUI for testing RealTime OGraf Graphics.
- Control GUI for testing Non-RealTime OGraf Graphics.

![Screenshot of the GUI](/docs/screenshot0.jpg?raw=true "Screenshot")

## Having a problem?

If the problem is related to the DevTool itself, please open an [issue here](https://github.com/SuperFlyTV/ograf-devtool/issues) or [contribute a fix](https://github.com/SuperFlyTV/ograf-devtool/pulls) yourself!

If the problem is related to the OGraf Specification, please [open an issue on the OGraf repository](https://github.com/ebu/ograf/issues).

## For Developers of the OGraf DevTool

```bash

npm i
npm run install:client


# Build client and serve it locally
npm run build:client
npm run start

# OR:
# Start the client in dev-mode and serve it locally:
npm run dev
```

### Deployment

Simply push to the `main` branch. A Github Action will publish a Docker Image and pull it onto the deployment server.

_(SuperFly-internal notes are [here](https://github.com/SuperFlyTV/internal-scripts/tree/main/SuperFlyTV/ograf-devtool).)_

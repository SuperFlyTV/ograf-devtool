# OGraf Devtool

<img src="docs/logo/ograf-logo-colour.svg" width="300"/>

This is a tool to help with developing <b>[OGraf](https://ograf.ebu.io/) Graphics</b>.

The tool is running at [https://ograf-devtool.vercel.app](https://ograf-devtool.vercel.app)

## For Developers

```bash

npm i
npm run install-client

npm run build

npm run start
```

### Testing for vercel

```bash
# This can only be run by maintainers (that have access to the vercel project)
npm i -g vercel

# Run local server in vercel dev mode
vercel dev

# Publish to vercel
npm run publish
```

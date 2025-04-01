
# ----------------------------------------------------------------------------------------
# Build image:

FROM node:22-alpine AS builder

WORKDIR /opt

COPY ./package.json ./package.json
COPY ./server ./server

COPY ./client/scripts ./client/scripts
COPY ./client/src ./client/src
COPY ./client/assets ./client/assets
COPY ./client/package.json ./client/package.json
COPY ./client/vite.config.js ./client/vite.config.js

# Fix a bug related to https://github.com/npm/cli/issues/4828 :
# RUN rm /opt/client/package-lock.json

# RUN npm i @rollup/rollup-linux-x64-musl
RUN npm i
RUN npm run install
RUN npm run build

# ----------------------------------------------------------------------------------------
# Deploy image:
FROM node:22-alpine


# COPY --from=builder /opt/package.json /opt/package.json
COPY --from=builder /opt/node_modules /opt/node_modules
COPY --from=builder /opt/server /opt/server

COPY --from=builder /opt/client/dist /opt/client/dist
COPY --from=builder /opt/client/assets /opt/client/assets
COPY --from=builder /opt/client/node_modules /opt/client/node_modules

WORKDIR /opt/

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.js"]


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

RUN npm i
RUN npm run install-client
RUN npm run build

# ----------------------------------------------------------------------------------------
# Deploy image:
FROM node:22-alpine


COPY --from=builder /opt/node_modules /opt/node_modules
COPY --from=builder /opt/server /opt/server

COPY --from=builder /opt/client/dist /opt/client/dist
COPY --from=builder /opt/client/assets /opt/client/assets
COPY --from=builder /opt/client/node_modules /opt/client/node_modules

WORKDIR /opt/

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.js"]

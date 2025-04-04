const express = require("express");
const path = require("path");
const Cache = require("./cache");
// const { Readable } = require("stream");

function startServer(port, devMode) {
  const app = express();
  const cache = new Cache();

  if (devMode) console.log("Running in dev mode");

  // Proxy requests to the Ograf API:
  app.get(["ograf", "/ograf/*"], (req, res) => {
    const url = req.url.replace(/^\/ograf/, "https://ograf.ebu.io");

    const sendResponse = (v) => {
      // set status
      res.statusCode = v.status;

      // Set CORS header
      res.setHeader("Access-Control-Allow-Origin", "*");

      res.type(v.type);
      res.send(v.buffer);
    };

    const cachedValue = cache.get(url);
    if (cachedValue !== null) {
      sendResponse(cachedValue);
      return;
    }

    fetch(url)
      .then(async (fetchResponse) => {
        const blob = await fetchResponse.blob();
        const buffer = Buffer.from(await blob.arrayBuffer());

        const cacheValue = {
          status: fetchResponse.status,
          type: blob.type,
          buffer,
        };
        // Cache the response for 15 minutes:
        cache.set(url, cacheValue, 15 * 60 * 1000);

        sendResponse(cacheValue);
      })
      .catch((err) => {
        console.error(err);
        res.status(500).send(`Error fetching ${url}: ${err}`);
      });
  });

  app.get("/clear-cache", (req, res) => {
    cache.clear();
    res.send("Cache cleared");
  });

  if (!devMode) {
    // Serve static files from the client/dist folder:
    const staticPath = path.resolve("./client/dist");
    console.log(`Serving static files from ${staticPath}`);
    app.use("/", express.static(staticPath));

    // Serve the index file for any non static matching files:
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  } else {
    console.log("Serving from Dev server");

    app.get("/*", (req, res) => {
      const url = req.url.replace(/^\//, "http://localhost:8083/");
      fetch(url)
        .then(async (fetchResponse) => {
          const blob = await fetchResponse.blob();
          const buffer = Buffer.from(await blob.arrayBuffer());

          res.statusCode = fetchResponse.status;

          res.type(blob.type);
          res.send(buffer);
        })
        .catch((err) => {
          console.error(err);
          res.status(500).send(`Error fetching ${url}: ${err}`);
        });
    });
  }

  app.listen(port);
  if (devMode) {
    console.log(`Server available at http://localhost:${port}`);
  } else {
    console.log(`Server started on port ${port}`);
  }

  return app;
}

module.exports = { startServer };

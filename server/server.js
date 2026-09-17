const express = require("express");
const path = require("path");
const Cache = require("./cache");
// const { Readable } = require("stream");

// Renders a small page that reports the OAuth result back to the window that opened the popup, then closes itself.
function githubOauthResultHtml({ token, error }) {
  const payload = JSON.stringify({ type: "github-oauth-token", token, error });
  return `<!DOCTYPE html><html><body><script>
		if (window.opener) window.opener.postMessage(${payload}, window.location.origin)
		window.close()
	</script>${error ? `<p>${error}</p>` : "<p>Signed in, you can close this window.</p>"}</body></html>`;
}

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

  // "Sign in with GitHub" OAuth, used by the client to raise the GitHub API rate limit.
  // Requires the OGRAF_DEVTOOL_APP_ID / OGRAF_DEVTOOL_APP_SECRET env vars to be set (of a GitHub OAuth App).
  app.get("/api/github/oauth/config", (req, res) => {
    res.json({ clientId: process.env.OGRAF_DEVTOOL_APP_ID || null });
  });

  app.get("/api/github/oauth/callback", async (req, res) => {
    const { code } = req.query;
    const clientId = process.env.OGRAF_DEVTOOL_APP_ID;
    const clientSecret = process.env.OGRAF_DEVTOOL_APP_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send(
        githubOauthResultHtml({
          error: "GitHub sign-in is not configured on this server.",
        }),
      );
      return;
    }
    if (!code) {
      res
        .status(400)
        .send(githubOauthResultHtml({ error: 'Missing "code" from GitHub.' }));
      return;
    }

    try {
      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        },
      );
      const tokenBody = await tokenRes.json();

      if (tokenBody.error || !tokenBody.access_token) {
        res.status(400).send(
          githubOauthResultHtml({
            error: tokenBody.error_description || "GitHub sign-in failed.",
          }),
        );
        return;
      }

      res.send(githubOauthResultHtml({ token: tokenBody.access_token }));
    } catch (err) {
      res.status(500).send(githubOauthResultHtml({ error: `${err}` }));
    }
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

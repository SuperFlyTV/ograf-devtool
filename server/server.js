const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
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

  // Endpoint to convert a WebM video (with alpha) to ProRes 4444 or QTRLE MOV with transparency using FFmpeg
  app.post(
    ["/api/convert/webm-to-mov", "/api/convert/webm-to-prores"],
    express.raw({
      type: () => true,
      limit: "1024mb",
    }),
    async (req, res) => {
      let bodyBuffer =
        Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;

      if (!bodyBuffer) {
        // Fallback in case raw body parser was bypassed
        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          if (chunks.length > 0) {
            bodyBuffer = Buffer.concat(chunks);
          }
        } catch (readErr) {
          console.error("Error reading request stream:", readErr);
        }
      }

      if (!bodyBuffer || bodyBuffer.length === 0) {
        console.warn(
          "[webm-to-mov] Received empty body. Headers:",
          req.headers,
        );
        return res.status(400).json({ error: "Missing WebM video payload." });
      }

      const requestedFormat = (
        req.query.format ||
        req.query.codec ||
        (req.path.includes("prores") ? "prores" : "prores")
      ).toLowerCase();

      const isQtrle =
        requestedFormat === "qtrle" || requestedFormat === "animation";

      const id = crypto.randomBytes(8).toString("hex");
      const tempInput = path.join(os.tmpdir(), `ograf_input_${id}.webm`);
      const tempOutput = path.join(os.tmpdir(), `ograf_output_${id}.mov`);

      try {
        await fs.promises.writeFile(tempInput, bodyBuffer);

        let ffmpegExecutable = process.env.FFMPEG_PATH;
        if (!ffmpegExecutable) {
          try {
            ffmpegExecutable = require("ffmpeg-static");
          } catch (_) {
            ffmpegExecutable = "ffmpeg";
          }
        }

        const formatName = isQtrle
          ? "QuickTime Animation (QTRLE)"
          : "ProRes 4444";
        console.log(
          `[FFmpeg] Converting WebM (${bodyBuffer.length} bytes) to ${formatName} using ${ffmpegExecutable}...`,
        );

        const ffmpegArgs = isQtrle
          ? [
              "-y",
              "-vcodec",
              "libvpx-vp9", // needed to read the webm input
              "-i",
              tempInput,
              "-c:v",
              "qtrle",
              "-pix_fmt",
              "yuva420p",
              tempOutput,
            ]
          : [
              "-y",
              "-vcodec",
              "libvpx-vp9", // needed to read the webm input
              "-i",
              tempInput,
              "-c:v",
              "prores_ks",
              "-profile:v",
              "4",
              "-pix_fmt",
              "yuva444p10le",
              tempOutput,
            ];

        await new Promise((resolve, reject) => {
          execFile(ffmpegExecutable, ffmpegArgs, (err, _stdout, stderr) => {
            if (err) {
              console.error("[FFmpeg] Conversion failed:", stderr);
              reject(new Error(stderr || err.message));
            } else {
              resolve();
            }
          });
        });

        const outputBuffer = await fs.promises.readFile(tempOutput);
        console.log(
          `[FFmpeg] ${formatName} conversion successful (${outputBuffer.length} bytes).`,
        );
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "video/quicktime");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="converted_${isQtrle ? "qtrle" : "prores"}.mov"`,
        );
        res.send(outputBuffer);
      } catch (err) {
        console.error("Failed to convert WebM to MOV:", err);
        res.status(500).json({ error: `Conversion failed: ${err.message}` });
      } finally {
        fs.promises.unlink(tempInput).catch(() => {});
        fs.promises.unlink(tempOutput).catch(() => {});
      }
    },
  );

  if (!devMode) {
    // Serve static files from the client/dist folder:
    const staticPath = path.resolve("./client/dist");
    console.log(`Serving static files from ${staticPath}`);
    app.use("/", express.static(staticPath));

    // Serve the index file for any non static matching files:
    app.get("*", (_req, res) => {
      // Set CORS headets, for shared-memory multithreading:
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

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

          // Set CORS headets, for shared-memory multithreading:
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

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

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

  // Serve bundled sample graphics:
  const samplesDir = path.resolve(__dirname, "ograf-samples");
  app.use(
    "/samples",
    express.static(samplesDir, {
      maxAge: "1d",
      setHeaders: (res, filePath) => {
        if (filePath.toLowerCase().endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader(
            "Cache-Control",
            "public, max-age=86400, stale-while-revalidate=604800",
          );
        }
      },
    }),
  );

  // OGraf Server API endpoints for sample pack:
  app.get(["/api/samples", "/api/samples/graphics"], (_req, res) => {
    try {
      if (!fs.existsSync(samplesDir)) {
        return res.json({
          name: "OGraf Sample Pack",
          author: { name: "SuperFly.tv", url: "https://superfly.tv" },
          graphics: [],
        });
      }
      const entries = fs.readdirSync(samplesDir, { withFileTypes: true });
      const graphicDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      res.json({
        name: "OGraf Sample Pack",
        author: { name: "SuperFly.tv", url: "https://superfly.tv" },
        graphics: graphicDirs,
      });
    } catch (err) {
      console.error("Error listing samples:", err);
      res.status(500).json({ error: "Failed to list samples" });
    }
  });

  app.get("/api/samples/graphics/:id", (req, res) => {
    try {
      const graphicId = req.params.id;
      const targetDir = path.join(samplesDir, graphicId);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Graphic not found" });
      }
      const files = fs.readdirSync(targetDir);
      const manifestFile = files.find((f) => f.endsWith(".ograf.json"));
      if (!manifestFile) {
        return res.status(404).json({ error: "Manifest file not found" });
      }
      const manifestContent = JSON.parse(
        fs.readFileSync(path.join(targetDir, manifestFile), "utf8"),
      );

      const fileList = [];
      function collectFiles(dir, relPrefix = "") {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          if (item.isDirectory()) {
            collectFiles(
              path.join(dir, item.name),
              `${relPrefix}${item.name}/`,
            );
          } else {
            fileList.push({ path: `${relPrefix}${item.name}` });
          }
        }
      }
      collectFiles(targetDir);

      res.json({
        id: graphicId,
        graphic: manifestContent,
        metadata: {
          content: {
            url: `/samples/${graphicId}/`,
            files: fileList,
          },
        },
      });
    } catch (err) {
      console.error("Error reading graphic sample:", err);
      res.status(500).json({ error: "Failed to read graphic sample" });
    }
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

  // Endpoint to convert a WebM video (with alpha) to ProRes 4444, QTRLE MOV, animated WebP, or animated GIF with transparency using FFmpeg
  app.post(
    [
      "/api/convert/webm-to-mov",
      "/api/convert/webm-to-prores",
      "/api/convert/webm-to-webp",
      "/api/convert/webm-to-gif",
    ],
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
        (req.path.includes("webp")
          ? "webp"
          : req.path.includes("gif")
          ? "gif"
          : req.path.includes("prores")
          ? "prores"
          : "prores")
      ).toLowerCase();

      const isWebp = requestedFormat === "webp";
      const isGif = requestedFormat === "gif";
      const isQtrle =
        requestedFormat === "qtrle" || requestedFormat === "animation";

      const outExt = isWebp ? ".webp" : isGif ? ".gif" : ".mov";
      const id = crypto.randomBytes(8).toString("hex");
      const tempInput = path.join(os.tmpdir(), `ograf_input_${id}.webm`);
      const tempOutput = path.join(os.tmpdir(), `ograf_output_${id}${outExt}`);

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

        const formatName = isWebp
          ? "Animated WebP"
          : isGif
          ? "Animated GIF"
          : isQtrle
          ? "QuickTime Animation (QTRLE)"
          : "ProRes 4444";
        console.log(
          `[FFmpeg] Converting WebM (${bodyBuffer.length} bytes) to ${formatName} using ${ffmpegExecutable}...`,
        );

        let ffmpegArgs = [];
        if (isWebp) {
          ffmpegArgs = [
            "-y",
            "-vcodec",
            "libvpx-vp9",
            "-i",
            tempInput,
            "-vcodec",
            "libwebp",
            "-loop",
            "0",
            "-pix_fmt",
            "yuva420p",
            tempOutput,
          ];
        } else if (isGif) {
          ffmpegArgs = [
            "-y",
            "-vcodec",
            "libvpx-vp9",
            "-i",
            tempInput,
            "-vf",
            "split[s0][s1];[s0]palettegen=reserve_transparent=on[p];[s1][p]paletteuse=alpha_threshold=128",
            "-loop",
            "0",
            tempOutput,
          ];
        } else if (isQtrle) {
          ffmpegArgs = [
            "-y",
            "-vcodec",
            "libvpx-vp9",
            "-i",
            tempInput,
            "-c:v",
            "qtrle",
            "-pix_fmt",
            "yuva420p",
            tempOutput,
          ];
        } else {
          ffmpegArgs = [
            "-y",
            "-vcodec",
            "libvpx-vp9",
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
        }

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
        res.setHeader(
          "Content-Type",
          isWebp
            ? "image/webp"
            : isGif
            ? "image/gif"
            : "video/quicktime",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="converted_${isWebp ? "animated.webp" : isGif ? "animated.gif" : isQtrle ? "qtrle.mov" : "prores.mov"}"`,
        );
        res.send(outputBuffer);
      } catch (err) {
        console.error(`Failed to convert WebM to ${requestedFormat}:`, err);
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
    app.use(
      "/",
      express.static(staticPath, {
        setHeaders: (res, filePath) => {
          const filename = path.basename(filePath).toLowerCase();
          const normalizedPath = filePath.toLowerCase();

          // HTML and Service Worker should never be cached long-term to allow immediate app updates
          if (
            filename === "index.html" ||
            filename === "service-worker.js" ||
            normalizedPath.endsWith(".html")
          ) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (
            normalizedPath.match(
              /\.(js|css|png|jpg|jpeg|gif|svg|webp|mp4|webm|ogv|woff|woff2|ttf|eot|ico)$/,
            )
          ) {
            // Static assets with fingerprints or static media files
            res.setHeader(
              "Cache-Control",
              "public, max-age=604800, stale-while-revalidate=86400",
            );
          } else {
            res.setHeader("Cache-Control", "public, max-age=3600");
          }
        },
      }),
    );

    // Serve the index file for any non static matching files:
    app.get("*", (_req, res) => {
      // Set CORS headers, for shared-memory multithreading:
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cache-Control", "no-cache");

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

const { startServer } = require("./server.js");

console.log("Starting server...");

const args = process.argv.slice(2);

let devMode = false;
for (const arg of args) {
  if (arg === "--dev") {
    devMode = true;
  }
}
const PORT = process.env.PORT || 3100;

const app = startServer(PORT, devMode);

module.exports = app;

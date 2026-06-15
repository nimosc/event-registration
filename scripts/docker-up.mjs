import { execSync } from "node:child_process";
import net from "node:net";

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(startPort = 3001) {
  for (let port = startPort; port < 65535; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("No free port found");
}

const build = process.argv.includes("--build");
const port = process.env.APP_PORT
  ? Number(process.env.APP_PORT)
  : await findFreePort();

const env = {
  ...process.env,
  APP_PORT: String(port),
  NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL ?? `http://localhost:${port}`,
};

const args = ["docker", "compose", "up", "-d", ...(build ? ["--build"] : [])];
console.log(`Starting container on port ${port}...`);
execSync(args.join(" "), { stdio: "inherit", env });
console.log(`\nApp running at http://localhost:${port}\n`);

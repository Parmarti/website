// Copy SVG icons next to the compiled node files.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".svg")) {
      const target = path.join(root, "dist", path.relative(root, full));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(full, target);
    }
  }
}
walk(path.join(root, "nodes"));
walk(path.join(root, "credentials"));

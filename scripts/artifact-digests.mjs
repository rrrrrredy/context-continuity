import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalize(value[key])
    ]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function treeManifest(root, exclude = () => false) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(resolvedRoot, target).replaceAll("\\", "/");
      if (exclude(relative, entry)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error("Release digests do not accept symbolic links: " + relative);
      }
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const content = await fs.readFile(target);
        files.push({
          path: relative,
          bytes: content.length,
          sha256: sha256Buffer(content)
        });
      }
    }
  }
  await visit(resolvedRoot);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    root: resolvedRoot,
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    sha256: sha256Buffer(Buffer.from(canonicalJson(files), "utf8"))
  };
}

function repositoryExclude(relative) {
  return relative === ".git"
    || relative.startsWith(".git/")
    || relative === "node_modules"
    || relative.startsWith("node_modules/")
    || relative === "coverage"
    || relative.startsWith("coverage/")
    || (relative.startsWith("validation/") && relative.endsWith(".json"));
}

export async function releaseArtifactDigests(repositoryRoot, pluginRoot) {
  const sourceTree = await treeManifest(repositoryRoot, repositoryExclude);
  const pluginTree = await treeManifest(pluginRoot);
  return {
    source_tree_sha256: sourceTree.sha256,
    source_tree_file_count: sourceTree.file_count,
    source_tree_total_bytes: sourceTree.total_bytes,
    plugin_package_sha256: pluginTree.sha256,
    plugin_package_file_count: pluginTree.file_count,
    plugin_package_total_bytes: pluginTree.total_bytes
  };
}

export async function directoryArtifactDigest(root) {
  const manifest = await treeManifest(root);
  return {
    plugin_package_sha256: manifest.sha256,
    plugin_package_file_count: manifest.file_count,
    plugin_package_total_bytes: manifest.total_bytes
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pluginRoot = path.join(repositoryRoot, "plugins", "context-continuity");
  process.stdout.write(JSON.stringify(
    await releaseArtifactDigests(repositoryRoot, pluginRoot),
    null,
    2
  ) + "\n");
}

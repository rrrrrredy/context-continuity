import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ContinuityError, assertCondition } from "./errors.mjs";

export function nowIso(clock = Date) {
  return new clock().toISOString();
}

export function sha256(value) {
  const bytes = typeof value === "string"
    ? value
    : canonicalJson(value);
  return crypto.createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        output[key] = canonicalize(value[key]);
      }
    }
    return output;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function makeId(prefix, value = crypto.randomUUID()) {
  return prefix + ":" + value;
}

export function taskKey(taskRef) {
  assertCondition(
    typeof taskRef === "string"
      && /^[A-Za-z][A-Za-z0-9_-]{1,31}:[^\s]{1,223}$/.test(taskRef)
      && taskRef.length <= 256,
    "INVALID_TASK_REF",
    "task_ref must be a trusted namespaced reference such as codex:<session_id>. "
      + "Never guess aliases such as current."
  );
  return sha256(taskRef).slice(0, 32);
}

export function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  let wide = 0;
  let narrow = 0;
  for (const character of text) {
    if (character.codePointAt(0) > 255) {
      wide += 1;
    } else {
      narrow += 1;
    }
  }
  return Math.ceil(wide * 0.9 + narrow / 4);
}

export function boundedText(value, maximum) {
  const text = String(value ?? "");
  if (text.length <= maximum) {
    return {
      text,
      truncated: false
    };
  }
  return {
    text: text.slice(0, maximum),
    truncated: true
  };
}

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function uniqueStrings(values, fieldName) {
  assertCondition(Array.isArray(values), "INVALID_FIELD", fieldName + " must be an array.");
  const result = [];
  const seen = new Set();
  for (const value of values) {
    assertCondition(typeof value === "string" && value.trim().length > 0,
      "INVALID_FIELD", fieldName + " must contain non-empty strings.");
    const normalized = value.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function resolveDataRoot(
  environment = process.env,
  entryPoint = process.argv[1]
) {
  if (environment.CONTEXT_CONTINUITY_DATA_DIR?.trim()) {
    return {
      path: path.resolve(environment.CONTEXT_CONTINUITY_DATA_DIR),
      durable: true,
      source: "CONTEXT_CONTINUITY_DATA_DIR"
    };
  }
  if (environment.CODEX_HOME?.trim()) {
    return {
      path: path.join(path.resolve(environment.CODEX_HOME), "plugin-data",
        "context-continuity", "v1"),
      durable: true,
      source: "CODEX_HOME"
    };
  }
  const pluginData = environment.PLUGIN_DATA || environment.CLAUDE_PLUGIN_DATA;
  if (pluginData?.trim()) {
    return {
      path: path.resolve(pluginData),
      durable: true,
      source: environment.PLUGIN_DATA ? "PLUGIN_DATA" : "CLAUDE_PLUGIN_DATA"
    };
  }
  if (entryPoint) {
    const resolvedEntry = path.resolve(entryPoint);
    const marker = `${path.sep}plugins${path.sep}cache${path.sep}`;
    const markerIndex = resolvedEntry.toLocaleLowerCase("en-US")
      .indexOf(marker.toLocaleLowerCase("en-US"));
    if (markerIndex > 0) {
      const inferredCodexHome = resolvedEntry.slice(0, markerIndex);
      return {
        path: path.join(
          inferredCodexHome,
          "plugin-data",
          "context-continuity",
          "v1"
        ),
        durable: true,
        source: "installed_cache"
      };
    }
  }
  return {
    path: path.join(os.tmpdir(), "context-continuity-unconfigured"),
    durable: false,
    source: "volatile_fallback"
  };
}

export async function canonicalWorkspace(cwd) {
  assertCondition(typeof cwd === "string" && cwd.trim().length > 0,
    "INVALID_CWD", "cwd is required.");
  const resolved = path.resolve(cwd);
  let canonical = resolved;
  try {
    canonical = await fs.realpath(resolved);
  } catch {
    canonical = resolved;
  }
  const normalized = process.platform === "win32"
    ? canonical.toLowerCase()
    : canonical;
  return normalized;
}

const WORKSPACE_FINGERPRINT_MAX_BYTES = 1024 * 1024;
const WORKSPACE_FINGERPRINT_MAX_UNTRACKED_FILES = 64;
const WORKSPACE_FINGERPRINT_MAX_FILE_BYTES = 128 * 1024;

function runGit(args, cwd, options = {}) {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: options.binary ? null : "utf8",
      timeout: options.timeout || 1500,
      maxBuffer: options.maxBuffer || WORKSPACE_FINGERPRINT_MAX_BYTES + 1,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (result.status === 0) {
      return options.binary
        ? Buffer.from(result.stdout || [])
        : String(result.stdout).trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function boundedDirectoryContent(root) {
  const queue = [root];
  const pieces = [Buffer.from("directory\0", "utf8")];
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    let entries;
    try {
      entries = (await fs.readdir(directory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return null;
    }
    for (const entry of entries) {
      const absoluteName = path.join(directory, entry.name);
      const relativeName = path.relative(root, absoluteName);
      if (entry.isDirectory()) {
        queue.push(absoluteName);
        continue;
      }
      fileCount += 1;
      if (fileCount > WORKSPACE_FINGERPRINT_MAX_UNTRACKED_FILES) {
        return null;
      }
      let bytes;
      try {
        if (entry.isSymbolicLink()) {
          bytes = Buffer.from("symlink:" + await fs.readlink(absoluteName), "utf8");
        } else {
          const stat = await fs.stat(absoluteName);
          if (!stat.isFile() || stat.size > WORKSPACE_FINGERPRINT_MAX_FILE_BYTES) {
            return null;
          }
          bytes = await fs.readFile(absoluteName);
        }
      } catch {
        return null;
      }
      totalBytes += Buffer.byteLength(relativeName, "utf8") + bytes.length;
      if (totalBytes > WORKSPACE_FINGERPRINT_MAX_BYTES) {
        return null;
      }
      pieces.push(
        Buffer.from(relativeName + "\0", "utf8"),
        Buffer.from(sha256(bytes.toString("base64")) + "\0", "utf8")
      );
    }
  }
  return crypto.createHash("sha256").update(Buffer.concat(pieces)).digest("hex");
}

export async function workspaceFingerprint(cwd, clock = Date) {
  const canonicalCwd = await canonicalWorkspace(cwd);
  const gitRoot = runGit(["rev-parse", "--show-toplevel"], canonicalCwd);
  const gitHead = gitRoot ? runGit(["rev-parse", "HEAD"], canonicalCwd) : null;
  let contentSha256 = null;
  let contentVerification = "unavailable";
  let dirtySha256 = null;
  if (gitRoot && gitHead) {
    const trackedDiff = runGit(
      ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
      canonicalCwd,
      { binary: true }
    );
    const untrackedOutput = runGit(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      canonicalCwd,
      { binary: true }
    );
    if (trackedDiff && untrackedOutput
        && trackedDiff.length <= WORKSPACE_FINGERPRINT_MAX_BYTES) {
      const untrackedNames = untrackedOutput.toString("utf8")
        .split("\0")
        .filter(Boolean)
        .sort();
      const pieces = [
        Buffer.from("tracked\0", "utf8"),
        trackedDiff,
        Buffer.from("\0untracked\0", "utf8")
      ];
      let totalBytes = trackedDiff.length;
      let bounded = untrackedNames.length <= WORKSPACE_FINGERPRINT_MAX_UNTRACKED_FILES;
      for (const relativeName of untrackedNames) {
        if (!bounded) {
          break;
        }
        const absoluteName = path.resolve(gitRoot, relativeName);
        const relativeCheck = path.relative(gitRoot, absoluteName);
        if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
          bounded = false;
          break;
        }
        try {
          const stat = await fs.lstat(absoluteName);
          let bytes;
          if (stat.isSymbolicLink()) {
            bytes = Buffer.from("symlink:" + await fs.readlink(absoluteName), "utf8");
          } else if (stat.isFile() && stat.size <= WORKSPACE_FINGERPRINT_MAX_FILE_BYTES) {
            bytes = await fs.readFile(absoluteName);
          } else {
            bounded = false;
            break;
          }
          totalBytes += Buffer.byteLength(relativeName, "utf8") + bytes.length;
          if (totalBytes > WORKSPACE_FINGERPRINT_MAX_BYTES) {
            bounded = false;
            break;
          }
          pieces.push(
            Buffer.from(relativeName + "\0", "utf8"),
            Buffer.from(sha256(bytes.toString("base64")) + "\0", "utf8")
          );
        } catch {
          bounded = false;
          break;
        }
      }
      if (bounded) {
        const content = Buffer.concat(pieces);
        contentSha256 = crypto.createHash("sha256").update(content).digest("hex");
        dirtySha256 = crypto.createHash("sha256").update(trackedDiff).digest("hex");
        contentVerification = "verified";
      }
    }
  } else if (!gitRoot) {
    contentSha256 = await boundedDirectoryContent(canonicalCwd);
    if (contentSha256) {
      contentVerification = "verified";
    }
  }
  const fingerprint = {
    canonical_cwd: canonicalCwd,
    cwd_sha256: sha256(canonicalCwd),
    git_root_sha256: gitRoot ? sha256(process.platform === "win32" ? gitRoot.toLowerCase() : gitRoot) : null,
    git_head: gitHead || null,
    dirty_sha256: dirtySha256,
    content_sha256: contentSha256,
    content_verification: contentVerification,
    captured_at: nowIso(clock)
  };
  fingerprint.digest = sha256({
    cwd_sha256: fingerprint.cwd_sha256,
    git_root_sha256: fingerprint.git_root_sha256,
    git_head: fingerprint.git_head,
    dirty_sha256: fingerprint.dirty_sha256,
    content_sha256: fingerprint.content_sha256,
    content_verification: fingerprint.content_verification
  });
  return fingerprint;
}

export function contextData(value, maximum = 2000) {
  const sanitized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return JSON.stringify(boundedText(sanitized, maximum).text);
}

export function assertPathInside(parent, candidate) {
  const parentResolved = path.resolve(parent);
  const candidateResolved = path.resolve(candidate);
  const relative = path.relative(parentResolved, candidateResolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ContinuityError(
      "PATH_ESCAPE",
      "Resolved state path escapes the configured data root.",
      { parent: parentResolved, candidate: candidateResolved }
    );
  }
}

export async function assertPathInsideReal(parent, candidate) {
  assertPathInside(parent, candidate);
  const parentResolved = path.resolve(parent);
  const candidateResolved = path.resolve(candidate);
  const relativeCandidate = path.relative(parentResolved, candidateResolved);
  const segments = relativeCandidate === "" ? [] : relativeCandidate.split(path.sep);
  const maximumAttempts = 3;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let current = parentResolved;
    let nearestExisting = null;
    const pathsToCheck = [parentResolved, ...segments.map((segment) => {
      current = path.join(current, segment);
      return current;
    })];
    for (const target of pathsToCheck) {
      try {
        const stats = await fs.lstat(target);
        if (stats.isSymbolicLink()) {
          throw new ContinuityError(
            "REALPATH_ESCAPE",
            "State paths cannot traverse a symbolic link or junction.",
            { parent: parentResolved, candidate: candidateResolved }
          );
        }
        nearestExisting = target;
      } catch (error) {
        if (error.code === "ENOENT") {
          break;
        }
        throw error;
      }
    }
    if (!nearestExisting) {
      return;
    }

    const wasRemovedDuringValidation = async (error, target) => {
      if (error.code === "ENOENT") {
        return true;
      }
      if (process.platform !== "win32" || error.code !== "EPERM") {
        return false;
      }
      try {
        await fs.lstat(target);
        return false;
      } catch (probeError) {
        return probeError.code === "ENOENT";
      }
    };
    const pathRaceError = () => new ContinuityError(
      "PATH_VALIDATION_RACE",
      "State path validation could not stabilize after repeated filesystem changes.",
      { parent: parentResolved, candidate: candidateResolved }
    );

    let realParent;
    try {
      realParent = await fs.realpath(parentResolved);
    } catch (error) {
      const transient = await wasRemovedDuringValidation(error, parentResolved);
      if (transient && attempt < maximumAttempts) {
        continue;
      }
      if (transient) {
        throw pathRaceError();
      }
      throw error;
    }

    let realCandidate;
    try {
      realCandidate = await fs.realpath(nearestExisting);
    } catch (error) {
      const transient = await wasRemovedDuringValidation(error, nearestExisting);
      if (transient && attempt < maximumAttempts) {
        continue;
      }
      if (transient) {
        throw pathRaceError();
      }
      throw error;
    }

    const relative = path.relative(realParent, realCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ContinuityError(
        "REALPATH_ESCAPE",
        "Resolved state path escapes the configured data root through a link or junction.",
        { parent: realParent, candidate: realCandidate }
      );
    }
    return;
  }
}

export async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = filePath + "." + crypto.randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true });
    } catch {
      // The original error is more useful.
    }
    throw error;
  }
}

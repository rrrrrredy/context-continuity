import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

function executableExtensions(command, environment) {
  if (process.platform !== "win32" || path.extname(command)) {
    return [""];
  }
  return String(environment.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
}

export async function resolveExecutable(
  command,
  workingDirectory = process.cwd(),
  environment = process.env
) {
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("Codex executable command must be a non-empty string.");
  }
  const hasSeparator = command.includes("/") || command.includes("\\");
  const baseCandidates = path.isAbsolute(command)
    ? [command]
    : hasSeparator
      ? [path.resolve(workingDirectory, command)]
      : String(environment.PATH || environment.Path || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, command));
  const candidates = [];
  for (const base of baseCandidates) {
    for (const extension of executableExtensions(command, environment)) {
      const candidate = base + extension;
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const realpath = await fs.realpath(candidate);
      const information = await fs.stat(realpath);
      if (information.isFile()) {
        return realpath;
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) {
        throw error;
      }
    }
  }
  throw Object.assign(
    new Error("Unable to resolve the tested Codex executable."),
    { code: "CODEX_EXECUTABLE_NOT_FOUND" }
  );
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function versionToken(value) {
  const match = String(value || "").match(
    /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/
  );
  return match ? match[0] : null;
}

export async function codexExecutableEvidence(
  command,
  workingDirectory = process.cwd(),
  environment = process.env
) {
  const realpath = await resolveExecutable(command, workingDirectory, environment);
  return {
    path: realpath,
    path_sha256: sha256Text(realpath),
    sha256: await sha256File(realpath)
  };
}

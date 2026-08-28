import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publicError } from "./errors.mjs";
import {
  ContinuityService,
  createServiceFromEnvironment
} from "./service.mjs";
import { resolveDataRoot } from "./util.mjs";

function parseArguments(argv) {
  const values = [...argv];
  let dataDir = null;
  const index = values.indexOf("--data-dir");
  if (index >= 0) {
    dataDir = values[index + 1];
    values.splice(index, 2);
  }
  return {
    command: values[0],
    rest: values.slice(1),
    dataDir
  };
}

function serviceFor(dataDir) {
  if (!dataDir) {
    return createServiceFromEnvironment(process.env);
  }
  return new ContinuityService({
    dataRootInfo: {
      path: path.resolve(dataDir),
      durable: true,
      source: "cli"
    }
  });
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

function usage() {
  return [
    "Usage:",
    "  node src/cli.mjs show <task_ref> [--data-dir <path>]",
    "  node src/cli.mjs record <task_ref> <expected_generation> <items.json> [--data-dir <path>]",
    "  node src/cli.mjs export <task_ref> <scope> [--data-dir <path>]",
    "  node src/cli.mjs rebuild <task_ref> [--data-dir <path>]",
    "  node src/cli.mjs off|on <task_ref> <confirm_task_ref> [--data-dir <path>]",
    "  node src/cli.mjs reset|delete <task_ref> <confirm_task_ref> [--data-dir <path>]"
  ].join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArguments(argv);
  const service = serviceFor(parsed.dataDir);
  const [taskRef, second, third] = parsed.rest;
  switch (parsed.command) {
    case "show":
      return service.getState({ task_ref: taskRef });
    case "record": {
      const document = await readJsonFile(third);
      return service.recordState({
        task_ref: taskRef,
        expected_generation: Number.parseInt(second, 10),
        ...document
      });
    }
    case "export":
      return service.exportHandoff({
        task_ref: taskRef,
        scope: second || "task"
      });
    case "rebuild":
      return service.manageState({
        task_ref: taskRef,
        action: parsed.command
      });
    case "off":
    case "on":
      return service.manageStateDirect({
        task_ref: taskRef,
        action: parsed.command,
        confirm_task_ref: second
      });
    case "reset":
    case "delete":
      return service.manageStateDirect({
        task_ref: taskRef,
        action: parsed.command,
        confirm_task_ref: second
      });
    default:
      throw Object.assign(new Error(usage()), {
        code: "INVALID_CLI_USAGE"
      });
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const result = await runCli();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify(publicError(error), null, 2) + "\n");
    process.exitCode = 1;
  }
}

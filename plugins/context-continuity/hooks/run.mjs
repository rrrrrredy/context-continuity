import { handleHook } from "../src/hook-handler.mjs";
import { MAX_MCP_INPUT_BYTES } from "../src/constants.mjs";

async function readStdin() {
  let input = "";
  let bytes = 0;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > MAX_MCP_INPUT_BYTES) {
      throw Object.assign(new Error("Hook input exceeds the byte limit."), {
        code: "HOOK_INPUT_LIMIT"
      });
    }
    input += chunk;
  }
  return input;
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw);
    const result = await handleHook(payload, process.env);
    if (result !== null && result !== undefined) {
      process.stdout.write(JSON.stringify(result));
    }
  } catch (error) {
    const code = error && typeof error.code === "string"
      ? error.code
      : "CONTINUITY_HOOK_FAILURE";
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: "Context Continuity failed open (" + code + "). The host continues without an added continuity guarantee."
    }));
  }
}

await main();

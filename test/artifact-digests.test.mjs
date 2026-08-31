import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { directoryArtifactDigest } from "../scripts/artifact-digests.mjs";

test("artifact digests normalize text line endings but preserve binary bytes", async () => {
  const scratch = await fs.mkdtemp(path.join(
    os.tmpdir(),
    "context-continuity-digest-"
  ));
  const lfRoot = path.join(scratch, "lf");
  const crlfRoot = path.join(scratch, "crlf");
  try {
    await fs.mkdir(lfRoot);
    await fs.mkdir(crlfRoot);
    await fs.writeFile(path.join(lfRoot, "fixture.mjs"), "one\ntwo\n");
    await fs.writeFile(path.join(crlfRoot, "fixture.mjs"), "one\r\ntwo\r\n");
    const binary = Buffer.from([0, 13, 10, 255]);
    await fs.writeFile(path.join(lfRoot, "fixture.bin"), binary);
    await fs.writeFile(path.join(crlfRoot, "fixture.bin"), binary);

    const lfDigest = await directoryArtifactDigest(lfRoot);
    const crlfDigest = await directoryArtifactDigest(crlfRoot);
    assert.equal(
      lfDigest.plugin_package_sha256,
      crlfDigest.plugin_package_sha256
    );

    await fs.writeFile(
      path.join(crlfRoot, "fixture.bin"),
      Buffer.from([0, 10, 255])
    );
    const changedBinaryDigest = await directoryArtifactDigest(crlfRoot);
    assert.notEqual(
      lfDigest.plugin_package_sha256,
      changedBinaryDigest.plugin_package_sha256
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

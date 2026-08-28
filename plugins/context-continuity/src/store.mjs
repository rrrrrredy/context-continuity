import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_LEDGER_BYTES,
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_RETENTION
} from "./constants.mjs";
import { ContinuityError, assertCondition } from "./errors.mjs";
import {
  appendSealedEvent,
  createLedger,
  projectLedger,
  verifyLedger
} from "./model.mjs";
import {
  assertPathInside,
  assertPathInsideReal,
  atomicWriteJson,
  nowIso,
  taskKey
} from "./util.mjs";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export class LedgerStore {
  constructor(dataRoot, options = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.clock = options.clock || Date;
    this.lockTimeoutMs = options.lockTimeoutMs || 2000;
    this.lockStaleMs = options.lockStaleMs || 300000;
  }

  taskDirectory(taskRef) {
    const directory = path.join(this.dataRoot, "tasks", taskKey(taskRef));
    assertPathInside(this.dataRoot, directory);
    return directory;
  }

  ledgerPath(taskRef) {
    return path.join(this.taskDirectory(taskRef), "ledger.json");
  }

  snapshotDirectory(taskRef) {
    return path.join(this.taskDirectory(taskRef), "snapshots");
  }

  snapshotFileName(snapshot) {
    const timestamp = snapshot.created_at.replace(/[^0-9]/g, "");
    const sequence = String(snapshot.event_sequence).padStart(8, "0");
    const identifier = snapshot.snapshot_id.replace(/[^A-Za-z0-9_.-]/g, "_");
    return timestamp + "-" + sequence + "-" + identifier + ".json";
  }

  lockPath(taskRef) {
    const filePath = path.join(this.dataRoot, "locks", taskKey(taskRef) + ".lock");
    assertPathInside(this.dataRoot, filePath);
    return filePath;
  }

  async ensureRoot() {
    await fs.mkdir(this.dataRoot, {
      recursive: true,
      mode: 0o700
    });
    await assertPathInsideReal(this.dataRoot, this.dataRoot);
    await fs.mkdir(path.join(this.dataRoot, "tasks"), {
      recursive: true,
      mode: 0o700
    });
    await assertPathInsideReal(this.dataRoot, path.join(this.dataRoot, "tasks"));
    await fs.mkdir(path.join(this.dataRoot, "locks"), {
      recursive: true,
      mode: 0o700
    });
    await assertPathInsideReal(this.dataRoot, path.join(this.dataRoot, "locks"));
  }

  async acquireLock(taskRef) {
    await this.ensureRoot();
    const filePath = this.lockPath(taskRef);
    const started = Date.now();
    while (Date.now() - started < this.lockTimeoutMs) {
      try {
        await assertPathInsideReal(this.dataRoot, filePath);
        const ownerToken = crypto.randomUUID();
        const handle = await fs.open(filePath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          owner_token: ownerToken,
          task_ref_sha256: taskKey(taskRef),
          acquired_at: nowIso(this.clock)
        }));
        return async () => {
          try {
            await handle.close();
          } finally {
            try {
              const current = JSON.parse(await fs.readFile(filePath, "utf8"));
              if (current.owner_token === ownerToken) {
                await assertPathInsideReal(this.dataRoot, filePath);
                await fs.rm(filePath, { force: true });
              }
            } catch (error) {
              if (error.code !== "ENOENT") {
                throw error;
              }
            }
          }
        };
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        try {
          const stats = await fs.stat(filePath);
          if (Date.now() - stats.mtimeMs > this.lockStaleMs) {
            await assertPathInsideReal(this.dataRoot, filePath);
            await fs.rm(filePath, { force: true });
            continue;
          }
        } catch (statError) {
          if (statError.code !== "ENOENT") {
            throw statError;
          }
        }
        await delay(25);
      }
    }
    throw new ContinuityError(
      "TASK_LOCK_TIMEOUT",
      "Timed out waiting for another continuity state writer.",
      { task_ref: taskRef }
    );
  }

  async readLedger(taskRef, createIfMissing = true) {
    const filePath = this.ledgerPath(taskRef);
    await assertPathInsideReal(this.dataRoot, filePath);
    try {
      const stats = await fs.stat(filePath);
      assertCondition(stats.size <= MAX_LEDGER_BYTES,
        "LEDGER_SIZE_LIMIT",
        "A task continuity ledger cannot exceed " + MAX_LEDGER_BYTES
          + " bytes. Use read-only export, then the explicit CLI archive/reset "
          + "or delete path before continuing.");
      const ledger = await readJson(filePath);
      verifyLedger(ledger, taskRef);
      return {
        ledger,
        existed: true
      };
    } catch (error) {
      if (error.code === "ENOENT" && createIfMissing) {
        return {
          ledger: createLedger(taskRef, this.clock),
          existed: false
        };
      }
      if (error instanceof SyntaxError) {
        throw new ContinuityError(
          "LEDGER_JSON_CORRUPT",
          "The task ledger is not valid JSON.",
          { path: filePath }
        );
      }
      throw error;
    }
  }

  async transact(taskRef, callback, options = {}) {
    const release = await this.acquireLock(taskRef);
    try {
      const loaded = await this.readLedger(taskRef, options.createIfMissing !== false);
      const ledger = loaded.ledger;
      let projection = projectLedger(ledger);
      let dirty = false;
      let snapshotWritten = false;
      const transaction = {
        ledger,
        get projection() {
          return projection;
        },
        append: (eventType, payload, eventOptions = {}) => {
          const event = appendSealedEvent(ledger, eventType, payload, {
            ...eventOptions,
            clock: this.clock
          });
          projection = projectLedger(ledger);
          dirty = true;
          return event;
        },
        writeSnapshot: async (snapshot) => {
          assertCondition(jsonBytes(snapshot) <= MAX_SNAPSHOT_BYTES,
            "SNAPSHOT_SIZE_LIMIT",
            "A continuity snapshot cannot exceed " + MAX_SNAPSHOT_BYTES + " bytes.");
          const snapshots = this.snapshotDirectory(taskRef);
          await assertPathInsideReal(this.dataRoot, this.taskDirectory(taskRef));
          await fs.mkdir(snapshots, { recursive: true, mode: 0o700 });
          await assertPathInsideReal(this.dataRoot, snapshots);
          const filePath = path.join(snapshots, this.snapshotFileName(snapshot));
          assertPathInside(snapshots, filePath);
          await assertPathInsideReal(this.dataRoot, filePath);
          await atomicWriteJson(filePath, snapshot);
          snapshotWritten = true;
          return filePath;
        },
        latestSnapshot: async () => this.referencedSnapshotUnlocked(
          taskRef,
          projection.latest_snapshot
        )
      };
      const result = await callback(transaction);
      if (dirty || !loaded.existed) {
        assertCondition(jsonBytes(ledger) <= MAX_LEDGER_BYTES,
          "LEDGER_SIZE_LIMIT",
          "A task continuity ledger cannot exceed " + MAX_LEDGER_BYTES
            + " bytes. Use read-only export, then the explicit CLI archive/reset "
            + "or delete path before continuing.");
        const ledgerPath = this.ledgerPath(taskRef);
        await assertPathInsideReal(this.dataRoot, ledgerPath);
        await atomicWriteJson(ledgerPath, ledger);
      }
      if (snapshotWritten) {
        await this.pruneSnapshotsUnlocked(
          taskRef,
          projection.latest_snapshot?.file_name || null
        );
      }
      return result;
    } finally {
      await release();
    }
  }

  async getProjection(taskRef, options = {}) {
    return this.transact(taskRef, (transaction) => transaction.projection, options);
  }

  async readProjection(taskRef) {
    const loaded = await this.readLedger(taskRef, false);
    return projectLedger(loaded.ledger);
  }

  async referencedSnapshotUnlocked(taskRef, reference) {
    if (!reference?.file_name) {
      return null;
    }
    const directory = this.snapshotDirectory(taskRef);
    const fileName = path.basename(reference.file_name);
    assertCondition(fileName === reference.file_name,
      "INVALID_SNAPSHOT_REFERENCE",
      "The ledger snapshot reference must be a single file name.");
    const target = path.join(directory, fileName);
    assertPathInside(directory, target);
    await assertPathInsideReal(this.dataRoot, target);
    try {
      const snapshot = await readJson(target);
      assertCondition(
        snapshot.snapshot_id === reference.snapshot_id
          && snapshot.snapshot_digest === reference.snapshot_digest
          && snapshot.projection_digest === reference.projection_digest
          && snapshot.generation === reference.generation
          && snapshot.event_sequence === reference.event_sequence,
        "SNAPSHOT_REFERENCE_MISMATCH",
        "The referenced snapshot file no longer matches the hash-sealed ledger reference."
      );
      return snapshot;
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async pruneSnapshotsUnlocked(taskRef, protectedFileName = null) {
    const directory = this.snapshotDirectory(taskRef);
    await assertPathInsideReal(this.dataRoot, directory);
    let names;
    try {
      names = (await fs.readdir(directory))
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    const removeCount = Math.max(0, names.length - SNAPSHOT_RETENTION);
    const remove = names
      .filter((name) => name !== protectedFileName)
      .slice(0, removeCount);
    for (const name of remove) {
      const target = path.join(directory, name);
      assertPathInside(directory, target);
      await assertPathInsideReal(this.dataRoot, target);
      await fs.rm(target, { force: true });
    }
  }

  async deleteTask(taskRef) {
    const release = await this.acquireLock(taskRef);
    try {
      const target = this.taskDirectory(taskRef);
      assertPathInside(path.join(this.dataRoot, "tasks"), target);
      await assertPathInsideReal(this.dataRoot, target);
      const archiveRoot = path.join(this.dataRoot, "archive");
      assertPathInside(this.dataRoot, archiveRoot);
      await assertPathInsideReal(this.dataRoot, archiveRoot);
      let archiveNames = [];
      try {
        archiveNames = await fs.readdir(archiveRoot);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      const key = taskKey(taskRef);
      const matchingArchives = archiveNames.filter((name) =>
        name.startsWith(key + "-")
        && /^\d+$/.test(name.slice(key.length + 1)));
      const archivedTargets = [];
      for (const name of matchingArchives) {
        const archivedTarget = path.join(archiveRoot, name);
        assertPathInside(archiveRoot, archivedTarget);
        await assertPathInsideReal(this.dataRoot, archivedTarget);
        archivedTargets.push(archivedTarget);
      }
      await assertPathInsideReal(this.dataRoot, target);
      await fs.rm(target, { recursive: true, force: true });
      for (const archivedTarget of archivedTargets) {
        await assertPathInsideReal(this.dataRoot, archivedTarget);
        await fs.rm(archivedTarget, { recursive: true, force: true });
      }
      return {
        deleted: true,
        task_ref: taskRef,
        archived_copies_deleted: matchingArchives.length
      };
    } finally {
      await release();
    }
  }

  async archiveTask(taskRef) {
    const release = await this.acquireLock(taskRef);
    try {
      const source = this.taskDirectory(taskRef);
      await assertPathInsideReal(this.dataRoot, source);
      const archiveRoot = path.join(this.dataRoot, "archive");
      assertPathInside(this.dataRoot, archiveRoot);
      await fs.mkdir(archiveRoot, { recursive: true, mode: 0o700 });
      await assertPathInsideReal(this.dataRoot, archiveRoot);
      const suffix = nowIso(this.clock).replace(/[^0-9]/g, "");
      const target = path.join(archiveRoot, taskKey(taskRef) + "-" + suffix);
      assertPathInside(archiveRoot, target);
      await assertPathInsideReal(this.dataRoot, source);
      await assertPathInsideReal(this.dataRoot, target);
      try {
        await fs.rename(source, target);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        return {
          archived: false,
          task_ref: taskRef,
          archive_path: null
        };
      }
      return {
        archived: true,
        task_ref: taskRef,
        archive_path: target
      };
    } finally {
      await release();
    }
  }
}

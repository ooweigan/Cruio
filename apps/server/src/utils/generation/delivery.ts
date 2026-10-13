import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "@/db/database";
import type { StoredOutput } from "@/utils/generation/provider";
import { hashOutput, makeStoredFilePath } from "@/utils/generation/provider";

const maxCommandOutput = 256 * 1024;
const maxVideoDurationSeconds = 30 * 60;

export type VideoToolchain = { ffmpegPath: string; ffprobePath: string };

async function readBounded(stream: ReadableStream<Uint8Array>, maximum: number, onLimit: () => void) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        onLimit();
        throw new Error("video_probe_output_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function runCommand(binary: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  const child = Bun.spawn([binary, ...args], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs,
    signal,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "FFREPORT")),
  });
  const stdoutPromise = readBounded(child.stdout, maxCommandOutput, () => child.kill());
  const stderrPromise = readBounded(child.stderr, maxCommandOutput, () => child.kill());
  let stdout: Buffer;
  let stderr: Buffer;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, child.exited]);
  } catch (error) {
    child.kill();
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutPromise, stderrPromise]);
    throw error;
  }
  return { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), exitCode };
}

export async function findVideoToolchain(dataDirectory: string): Promise<VideoToolchain | null> {
  const explicitFfmpeg = process.env.CRUIO_FFMPEG_PATH;
  const explicitFfprobe = process.env.CRUIO_FFPROBE_PATH;
  if (Boolean(explicitFfmpeg) !== Boolean(explicitFfprobe)) return null;
  if (explicitFfmpeg && explicitFfprobe) {
    try {
      const [ffmpeg, ffprobe] = await Promise.all([
        runCommand(explicitFfmpeg, ["-version"], 15_000), runCommand(explicitFfprobe, ["-version"], 15_000),
      ]);
      if (ffmpeg.exitCode === 0 && ffmpeg.stdout.startsWith("ffmpeg version ")
        && ffprobe.exitCode === 0 && ffprobe.stdout.startsWith("ffprobe version ")) {
        return { ffmpegPath: explicitFfmpeg, ffprobePath: explicitFfprobe };
      }
    } catch { return null; }
    return null;
  }
  const directory = resolve(dataDirectory, "ffmpeg", `${process.platform}-${process.arch}`);
  const entries = await Promise.all(["ffmpeg", "ffprobe"].map(name => Bun.file(join(directory, process.platform === "win32" ? `${name}.exe` : name)).exists()));
  const ffmpegPath = entries[0] ? join(directory, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg") : Bun.which("ffmpeg");
  const ffprobePath = entries[1] ? join(directory, process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : Bun.which("ffprobe");
  if (!ffmpegPath || !ffprobePath) return null;
  try {
    const [ffmpeg, ffprobe] = await Promise.all([
      runCommand(ffmpegPath, ["-version"], 15_000), runCommand(ffprobePath, ["-version"], 15_000),
    ]);
    if (ffmpeg.exitCode !== 0 || !ffmpeg.stdout.startsWith("ffmpeg version ")
      || ffprobe.exitCode !== 0 || !ffprobe.stdout.startsWith("ffprobe version ")) return null;
    return { ffmpegPath, ffprobePath };
  } catch { return null; }
}

export async function validateVideoOutput(bytes: Uint8Array, toolchain: VideoToolchain, signal?: AbortSignal) {
  if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new Error("video_result_size_invalid");
  const directory = await mkdtemp(join(tmpdir(), "cruio-video-check-"));
  await chmod(directory, 0o700);
  const input = join(directory, "result.mp4");
  try {
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    const probe = await runCommand(toolchain.ffprobePath, [
      "-protocol_whitelist", "file,pipe", "-f", "mov", "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type", "-of", "json", input,
    ], 30_000, signal);
    if (probe.exitCode !== 0) throw new Error("video_result_invalid");
    const metadata = JSON.parse(probe.stdout) as { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string }[] };
    if (!metadata.format?.format_name?.split(",").some(format => ["mp4", "mov"].includes(format))
      || !metadata.streams?.some(stream => stream.codec_type === "video")) throw new Error("video_result_invalid");
    const duration = Number(metadata.format.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxVideoDurationSeconds) throw new Error("video_result_duration_invalid");
    const decoded = await runCommand(toolchain.ffmpegPath, [
      "-nostdin", "-protocol_whitelist", "file,pipe", "-f", "mov", "-v", "error", "-xerror", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-",
    ], 10 * 60_000, signal);
    if (decoded.exitCode !== 0) throw new Error("video_result_decode_failed");
    return true;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function persistGenerationOutputs(input: {
  transaction: Database; taskId: string; userId: string; snapshot: { operation: string }; storageDirectory: string;
  outputs: StoredOutput[]; claimToken: string; providerTaskId?: string; providerStatus?: string; providerUsage?: Record<string, unknown>;
}) {
  const files: { id: string; storageKey: string; filePath: string; size: number; sha256: string; mediaType: string; mimeType: string }[] = [];
  try {
    for (const output of input.outputs) {
      const id = randomUUID();
      const storageKey = randomUUID();
      const filePath = makeStoredFilePath(input.storageDirectory, input.userId, storageKey);
      const directory = join(input.storageDirectory, "generationResults", input.userId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      let writtenSize = 0;
      try {
        await writeFile(temporaryPath, output.bytes, { flag: "wx", mode: 0o600 });
        const written = await stat(temporaryPath);
        if (!written.isFile() || written.size !== output.bytes.byteLength || written.size <= 0) throw new Error("result_copy_incomplete");
        if (hashOutput(await readFile(temporaryPath)) !== hashOutput(output.bytes)) throw new Error("result_copy_hash_mismatch");
        writtenSize = written.size;
        await rename(temporaryPath, filePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      files.push({ id, storageKey, filePath, size: writtenSize, sha256: hashOutput(output.bytes), mediaType: output.mediaType, mimeType: output.mimeType });
    }
    if (!files.length) throw new Error("empty_provider_result");
    const tasks = await input.transaction<{ id: string; status: string; claimToken: string | null }[]>`
      SELECT id, status, worker_claim_token AS "claimToken" FROM generation_tasks WHERE id = ${input.taskId} FOR UPDATE
    `;
    const task = tasks[0];
    if (!task || !["running", "unknown"].includes(task.status) || task.claimToken !== input.claimToken) throw new Error("generation_task_claim_lost");
    for (const file of files) {
      await input.transaction`
        INSERT INTO generation_results (id, task_id, user_id, media_type, mime_type, storage_key, size, sha256)
        VALUES (${file.id}, ${input.taskId}, ${input.userId}, ${file.mediaType}, ${file.mimeType}, ${file.storageKey}, ${file.size}, ${file.sha256})
      `;
    }
    await input.transaction`
      UPDATE generation_tasks SET status = 'delivered', result_summary = ${JSON.stringify(files.map(file => ({ resultId: file.id, mediaType: file.mediaType, mimeType: file.mimeType })))}::text::jsonb,
        provider_task_id = COALESCE(${input.providerTaskId ?? null}, provider_task_id),
        provider_status = ${input.providerStatus ?? "succeeded"}, provider_usage = ${input.providerUsage ? JSON.stringify(input.providerUsage) : null}::text::jsonb,
        worker_claim_token = NULL, worker_claimed_until = NULL, safe_error = NULL, updated_at = now()
      WHERE id = ${input.taskId}
    `;
    const attempts = await input.transaction<{ attemptNumber: number }[]>`
      SELECT COALESCE(max(attempt_number), 0) + 1 AS "attemptNumber" FROM generation_task_attempts WHERE task_id = ${input.taskId}
    `;
    await input.transaction`
      INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase, provider_task_id, provider_status)
      VALUES (${randomUUID()}, ${input.taskId}, ${attempts[0].attemptNumber}, 'delivered', ${input.providerTaskId ?? null}, ${input.providerStatus ?? "succeeded"})
    `;
    return files.map(({ filePath: _filePath, ...file }) => file);
  } catch (error) {
    await Promise.all(files.map(file => rm(file.filePath, { force: true }).catch(() => undefined)));
    throw error;
  }
}

export async function removeStoredGenerationOutput(storageDirectory: string, userId: string, storageKey: string) {
  const filePath = makeStoredFilePath(storageDirectory, userId, storageKey);
  const expectedRoot = resolve(storageDirectory, "generationResults", userId);
  if (!filePath.startsWith(`${expectedRoot}/`) && !filePath.startsWith(`${expectedRoot}\\`)) return;
  await rm(filePath, { force: true });
}

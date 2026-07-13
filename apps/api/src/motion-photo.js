import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const MP4_SEARCH_PADDING = 4096;

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return "";
}

export function findJpegEnd(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return -1;
  for (let index = 2; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 0xff && buffer[index + 1] === 0xd9) return index + 2;
  }
  return -1;
}

export function findMotionVideoStart(buffer) {
  const jpegEnd = findJpegEnd(buffer);
  if (jpegEnd < 0) return -1;
  const ftypOffset = buffer.indexOf(Buffer.from("ftyp"), jpegEnd);
  if (ftypOffset < jpegEnd + 4 || ftypOffset > jpegEnd + MP4_SEARCH_PADDING) return -1;
  const mp4Start = ftypOffset - 4;
  const boxSize = buffer.readUInt32BE(mp4Start);
  if (boxSize < 8 || boxSize > 4096 || mp4Start + boxSize > buffer.length) return -1;
  return mp4Start;
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) child.kill();
    }, 120_000);

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-6000);
    });
    child.once("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg 退出，代码 ${code ?? signal ?? "unknown"}`));
    });
  });
}

export async function prepareMomentMedia(file, { uploadDir, ffmpegPath = "ffmpeg" }) {
  const imageUrl = `/uploads/${file.filename}`;
  const source = await fs.readFile(file.path);
  const imageType = detectImageType(source);
  if (!imageType) {
    const error = new Error("文件内容不是受支持的照片格式");
    error.status = 400;
    throw error;
  }
  if (imageType !== "jpeg") return { imageUrl, videoUrl: "", isMotionPhoto: false };

  const videoStart = findMotionVideoStart(source);
  if (videoStart < 0) return { imageUrl, videoUrl: "", isMotionPhoto: false };

  const baseName = path.parse(file.filename).name;
  const sourceVideoPath = path.join(uploadDir, `${baseName}.motion-source.mp4`);
  const outputFilename = `${baseName}.motion.mp4`;
  const outputPath = path.join(uploadDir, outputFilename);

  try {
    await fs.writeFile(sourceVideoPath, source.subarray(videoStart));
    await runFfmpeg(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", sourceVideoPath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-tag:v", "avc1",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    const output = await fs.stat(outputPath);
    if (!output.isFile() || output.size === 0) throw new Error("转码结果为空");
    return { imageUrl, videoUrl: `/uploads/${outputFilename}`, isMotionPhoto: true };
  } catch (cause) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
    const error = new Error("动态照片处理失败，请确认后端已经安装 FFmpeg");
    error.status = 422;
    error.cause = cause;
    throw error;
  } finally {
    await fs.rm(sourceVideoPath, { force: true }).catch(() => {});
  }
}

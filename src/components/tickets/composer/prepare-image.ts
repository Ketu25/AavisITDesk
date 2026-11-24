import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  cleanFileName,
  formatBytes,
  isAttachmentType,
  type AttachmentType,
} from "@/lib/attachments";

export type PreparedImage = {
  blob: Blob;
  type: AttachmentType;
  name: string;
  width: number;
  height: number;
};

/** A file that cannot be attached, with a message written for the person who tried. */
export class ImageRejected extends Error {}

/** Anything larger is refused before decoding: it could exhaust a phone's memory. */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/** iOS Safari draws nothing onto a canvas larger than this (4096²). */
const MAX_CANVAS_PIXELS = 16_777_216;

/** Kept exactly as they arrive when they fit — re-encoding would only lose detail. */
const KEPT_AS_IS = new Set<AttachmentType>(["image/png", "image/gif", "image/webp"]);

/** Formats a browser may be able to open even though we do not store them. */
const PHOTO_FORMATS = new Set(["image/heic", "image/heif", "image/avif"]);

const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Windows often reports HEIC, and some drags report anything, with an empty type. */
function typeOf(file: File) {
  const declared = file.type.toLowerCase();
  return declared || BY_EXTENSION[extensionOf(file.name)] || "";
}

function displayName(file: File) {
  return file.name ? `“${file.name}”` : "That image";
}

/**
 * Pasted screenshots arrive named "image.png" whatever made them. A name with
 * a date reads better in the thread and as a download.
 */
function nameFor(file: File, type: AttachmentType, pasted: boolean) {
  const ext = ATTACHMENT_TYPES[type];
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp|tiff?|bmp)$/i.test(file.name);

  if (pasted && generic) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Screenshot ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.${ext}`;
  }

  const dot = file.name.lastIndexOf(".");
  const base = cleanFileName(dot > 0 ? file.name.slice(0, dot) : file.name).slice(0, 100);
  return `${base}.${ext}`;
}

async function decode(url: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("empty image");
  return image;
}

/**
 * Draws the image and saves it again. The new file carries pixels only — no
 * EXIF block, so no GPS position from a phone photo. Browsers apply the EXIF
 * rotation when drawing, so the result is the right way up.
 */
async function reencode(
  image: HTMLImageElement,
  type: "image/jpeg" | "image/png",
  quality?: number,
) {
  const area = image.naturalWidth * image.naturalHeight;
  const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / area));
  const width = Math.max(1, Math.floor(image.naturalWidth * scale));
  const height = Math.max(1, Math.floor(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");

  // JPEG has no transparency; without a fill, clear pixels come out black.
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Hand the pixel buffer back now; iOS counts canvas memory against the tab.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("encode failed");
  return { blob, width, height };
}

/** Fits a photo under the limit, stepping quality down rather than refusing at once. */
async function asJpeg(image: HTMLImageElement) {
  for (const quality of [0.9, 0.8, 0.7]) {
    const result = await reencode(image, "image/jpeg", quality);
    if (result.blob.size <= MAX_ATTACHMENT_BYTES) return result;
  }
  return null;
}

/**
 * Turns whatever was pasted, dropped or picked into something the bucket will
 * take, or explains why not.
 *
 * - PNG, GIF and WebP within 10 MB go up untouched.
 * - JPEG is always re-saved, to strip location data from phone photos.
 * - HEIC/AVIF (iPhone photos on a Mac), BMP and TIFF are converted when this
 *   browser can open them. Chrome cannot open HEIC; that is said plainly.
 * - A PNG or WebP over 10 MB becomes a JPEG; a GIF over 10 MB is refused, as
 *   converting it would stop it moving.
 * - Decoding every file is also the check that it is an image at all — a
 *   renamed document fails here rather than showing as a broken picture.
 */
export async function prepareImage(file: File, { pasted }: { pasted: boolean }): Promise<PreparedImage> {
  const type = typeOf(file);
  const label = displayName(file);

  if (!type.startsWith("image/") || type === "image/svg+xml") {
    throw new ImageRejected(`${label} isn’t an image. Attach a PNG, JPEG, GIF or WebP.`);
  }
  if (file.size === 0) throw new ImageRejected(`${label} is empty.`);
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageRejected(`${label} is ${formatBytes(file.size)} — images can be up to 10 MB.`);
  }

  const url = URL.createObjectURL(file);
  try {
    let image: HTMLImageElement;
    try {
      image = await decode(url);
    } catch {
      throw new ImageRejected(
        PHOTO_FORMATS.has(type)
          ? `${label} is a ${extensionOf(file.name).toUpperCase() || "HEIC"} photo, which this browser can’t open. Save it as JPEG first, or take a screenshot of it.`
          : `${label} couldn’t be read as an image. It may be damaged, or not really a picture.`,
      );
    }

    const width = image.naturalWidth;
    const height = image.naturalHeight;

    if (isAttachmentType(type) && KEPT_AS_IS.has(type) && file.size <= MAX_ATTACHMENT_BYTES) {
      return { blob: file, type, name: nameFor(file, type, pasted), width, height };
    }

    if (type === "image/gif") {
      throw new ImageRejected(`${label} is ${formatBytes(file.size)} — GIFs can be up to 10 MB.`);
    }

    try {
      // Screenshot-like sources stay lossless when they fit.
      if (type === "image/bmp" || type === "image/tiff") {
        const png = await reencode(image, "image/png");
        if (png.blob.size <= MAX_ATTACHMENT_BYTES) {
          return { ...png, type: "image/png", name: nameFor(file, "image/png", pasted) };
        }
      }

      const jpeg = await asJpeg(image);
      if (!jpeg) {
        throw new ImageRejected(`${label} is too detailed to fit in 10 MB. Crop it or take a smaller screenshot.`);
      }
      return { ...jpeg, type: "image/jpeg", name: nameFor(file, "image/jpeg", pasted) };
    } catch (error) {
      if (error instanceof ImageRejected) throw error;
      throw new ImageRejected(`${label} couldn’t be prepared for upload. Try saving it as PNG or JPEG first.`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

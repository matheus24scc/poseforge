import { db, type AssetKind, type AssetRow } from "./db";

// Content-addressed blob store in IndexedDB. The sha-256 of the contents is
// the asset id, which is what makes generation caching (inputsHash), future
// bundle export/sync diffs, and provider re-download recovery cheap: the same
// bytes always land on the same id.

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function putBlob(blob: Blob, kind: AssetKind, label?: string): Promise<AssetRow> {
  const buf = await blob.arrayBuffer();
  const id = await sha256Hex(buf);
  const typed = blob.type ? blob : new Blob([buf], { type: "application/octet-stream" });
  await db.blobs.put({ id, blob: typed });
  const existing = await db.assets.get(id);
  if (existing) return existing;
  const row: AssetRow = {
    id,
    kind,
    mime: typed.type,
    size: blob.size,
    label,
    createdAt: Date.now(),
  };
  await db.assets.put(row);
  return row;
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  const row = await db.assets.get(id);
  if (!row) return null;
  const stored = await db.blobs.get(id);
  if (stored) return stored.blob;
  // Legacy v1 storage: blobs lived in OPFS. If the file is still there,
  // migrate it into IndexedDB on first read.
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("assets");
    const handle = await dir.getFileHandle(id);
    const file = await handle.getFile();
    const blob = new Blob([await file.arrayBuffer()], { type: row.mime });
    await db.blobs.put({ id, blob });
    return blob;
  } catch {
    return null;
  }
}

const urlCache = new Map<string, string>();

export async function getAssetUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await getAssetBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export interface InlineData {
  mimeType: string;
  data: string; // base64, no data: prefix
}

export async function assetToInlineData(id: string): Promise<InlineData> {
  const blob = await getAssetBlob(id);
  if (!blob) throw new Error(`Asset ${id.slice(0, 8)}… not found in local store`);
  return blobToInlineData(blob);
}

export function blobToInlineData(blob: Blob): Promise<InlineData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUri = reader.result as string;
      const comma = dataUri.indexOf(",");
      resolve({
        mimeType: blob.type || "application/octet-stream",
        data: dataUri.slice(comma + 1),
      });
    };
    reader.readAsDataURL(blob);
  });
}

export async function assetToDataUri(id: string): Promise<string> {
  const inline = await assetToInlineData(id);
  return `data:${inline.mimeType};base64,${inline.data}`;
}

export function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function dataUriToBlob(dataUri: string): Blob {
  const comma = dataUri.indexOf(",");
  const meta = dataUri.slice(0, comma);
  const mime = meta.slice(meta.indexOf(":") + 1, meta.indexOf(";"));
  return base64ToBlob(dataUri.slice(comma + 1), mime);
}

export async function downloadAsset(id: string, filename: string): Promise<void> {
  const url = await getAssetUrl(id);
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

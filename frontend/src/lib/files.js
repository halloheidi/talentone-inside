// Helpers für Datei-Uploads (base64 → JSON-API).

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadFile(file, postFn) {
  const fileData = await fileToBase64(file);
  return postFn({
    fileData,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
  });
}

// Lädt eine (cross-origin) URL als Blob und triggert einen Download im Browser.
// Direktes <a href download> reicht nicht für Cross-Origin (Supabase Storage),
// daher der Umweg über fetch + ObjectURL.
export async function downloadFromUrl(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

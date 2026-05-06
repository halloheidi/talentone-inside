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

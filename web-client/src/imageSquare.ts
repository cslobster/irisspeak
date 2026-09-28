/** A picked photo as a square JPEG, centre-cropped and scaled to `size` px, returned as the bare base64 payload
 *  the vocabulary API stores. A phone photo is 3-5 MB; stored as-is it lands in the database and syncs to every
 *  device. A card icon is shown at under 100 px, so 256 px square at quality 0.82 (~20-30 KB) is plenty. */
export async function squareJpegBase64(file: File, size = 256, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('not an image')); i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);   // a transparent PNG must not turn black as JPEG
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', quality).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

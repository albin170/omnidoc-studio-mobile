import { PDFDocument } from 'pdf-lib';

async function rasterizeImageBlobToPngBytes(imageBlob: Blob): Promise<ArrayBuffer> {
  const img = new Image();
  const url = URL.createObjectURL(imageBlob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image for PDF embedding.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth || img.width);
    canvas.height = Math.max(1, img.naturalHeight || img.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable for image rasterization.');
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png');
    });
    return await pngBlob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function convertImageToPdf(
  imageBlob: Blob,
  options?: { pageSize?: 'A4' | 'fit'; orientation?: 'portrait' | 'landscape' }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const imageBytes = await imageBlob.arrayBuffer();
  const header = new Uint8Array(imageBytes.slice(0, 4));
  const hasPngMagic =
    header.length >= 4 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const hasJpgMagic = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;

  let embeddedImage;
  if (hasPngMagic) {
    embeddedImage = await pdfDoc.embedPng(imageBytes);
  } else if (hasJpgMagic) {
    embeddedImage = await pdfDoc.embedJpg(imageBytes);
  } else {
    const pngBytes = await rasterizeImageBlobToPngBytes(imageBlob);
    embeddedImage = await pdfDoc.embedPng(pngBytes);
  }

  const imgWidth = embeddedImage.width;
  const imgHeight = embeddedImage.height;

  let pageWidth: number;
  let pageHeight: number;
  if (options?.pageSize === 'fit') {
    pageWidth = imgWidth;
    pageHeight = imgHeight;
  } else if (options?.orientation === 'landscape' || imgWidth > imgHeight) {
    pageWidth = 841.89;
    pageHeight = 595.28;
  } else {
    pageWidth = 595.28;
    pageHeight = 841.89;
  }

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const margin = options?.pageSize === 'fit' ? 0 : 36;
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  const scale = Math.min(availW / imgWidth, availH / imgHeight, 1);
  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;

  page.drawImage(embeddedImage, {
    x: (pageWidth - drawW) / 2,
    y: (pageHeight - drawH) / 2,
    width: drawW,
    height: drawH,
  });

  return await pdfDoc.save();
}

export async function convertImageFormat(
  file: File,
  targetFormat: 'png' | 'jpg' | 'webp',
  quality = 0.92
): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(file);

  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    if (targetFormat === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);

    const mime = targetFormat === 'jpg' ? 'image/jpeg' : `image/${targetFormat}`;
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob([])), mime, quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

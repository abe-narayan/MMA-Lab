/**
 * MPFB2's region masks (CC0; body UV layout) packed into two RGBA textures at preload:
 *   A = lips, fingernails, toenails, areolae
 *   B = ears, eyelids, face, 0
 * The source files are 2048² greyscale JPEGs; they are decoded by the browser and downsampled to
 * 1024², which is plenty for soft region masks.
 */
import * as THREE from 'three/webgpu';

const SIZE = 1024;

async function decode(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mask missing: ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'high' });
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(SIZE, SIZE)
    : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const ctx = (canvas as OffscreenCanvas).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function pack(channels: (Uint8ClampedArray | null)[]): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  // Image rows run top-down; three's DataTexture rows run bottom-up (flipY is not applied to
  // data textures), and the MakeHuman UVs are OpenGL-style (v up), so flip while packing.
  for (let y = 0; y < SIZE; y++) {
    const srcRow = (SIZE - 1 - y) * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      for (let c = 0; c < 4; c++) {
        const ch = channels[c];
        data[o + c] = ch ? ch[(srcRow + x) * 4] : 0;
      }
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export async function loadMasks(base = '/assets/body/'): Promise<{ maskA: THREE.DataTexture; maskB: THREE.DataTexture }> {
  const names = ['lips', 'fingernails', 'toenails', 'aureolae', 'ears', 'eyelids', 'face', 'inside-mouth'];
  const imgs = await Promise.all(names.map((n) => decode(`${base}masks/mpfb_${n}.jpg`)));
  return { maskA: pack(imgs.slice(0, 4)), maskB: pack(imgs.slice(4, 8)) };
}

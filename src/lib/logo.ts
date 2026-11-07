// Company logo: made small enough to keep in the database (and on the phone for offline use), and
// its main colors picked out so the app can take the brand color from it.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64ToBytes, decodePng, pickColors } from './png';

const MAX_SIDE = 256;
/** Data URLs longer than this are refused (about 220 KB of image). */
export const MAX_LOGO_CHARS = 300_000;

/** The picked image as a PNG data URL, at most 256 px on its longest side (transparency kept). */
export async function prepareLogo(uri: string): Promise<string> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = original;
  const ctx = ImageManipulator.manipulate(original);
  if (Math.max(width, height) > MAX_SIDE) {
    ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  let saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if ((saved.base64?.length ?? 0) > MAX_LOGO_CHARS - 30) {
    // A photo-like logo: JPEG is much smaller (no transparency).
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (!saved.base64) throw new Error('Could not read the image.');
    return `data:image/jpeg;base64,${saved.base64}`;
  }
  if (!saved.base64) throw new Error('Could not read the image.');
  return `data:image/png;base64,${saved.base64}`;
}

/** Brand color candidates from a logo, best first (at most 5). Empty when the logo has no color. */
export async function logoColors(uri: string): Promise<string[]> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 48 });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) return [];
  const png = decodePng(base64ToBytes(saved.base64));
  return png ? pickColors(png.pixels) : [];
}

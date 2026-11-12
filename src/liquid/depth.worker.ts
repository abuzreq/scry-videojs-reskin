// Runs the depth model off the main thread. Loaded only when the depth tier is switched on.
import { AutoModel, Tensor } from '@huggingface/transformers';

/** Depth Anything V2 Small (Apache-2.0), the ONNX export published for transformers.js. */
const MODEL = 'onnx-community/depth-anything-v2-small';
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type Request = { type: 'init'; device: 'webgpu' | 'wasm' } | { type: 'run'; id: number; bitmap: ImageBitmap };

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

type Model = (inputs: Record<string, unknown>) => Promise<Record<string, Tensor>>;

let model: Model | null = null;
let canvas: OffscreenCanvas | null = null;

async function load(device: 'webgpu' | 'wasm'): Promise<Model> {
  // Smallest download first. On a GPU that is the 4-bit, half-float file (19 MB); it needs half-float shaders, so
  // fall back to the 4-bit full-float one where those are missing. WebAssembly takes the 8-bit file.
  const dtypes = device === 'webgpu' ? (['q4f16', 'q4'] as const) : (['q8'] as const);
  let failure: unknown;

  for (const dtype of dtypes) {
    try {
      return (await AutoModel.from_pretrained(MODEL, { device, dtype })) as unknown as Model;
    } catch (error) {
      failure = error;
    }
  }

  throw failure;
}

async function estimate(bitmap: ImageBitmap): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { width, height } = bitmap;

  canvas ??= new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true })!;

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pixels = context.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const input = new Float32Array(plane * 3);

  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      input[channel * plane + i] = (pixels[i * 4 + channel]! / 255 - MEAN[channel]!) / STD[channel]!;
    }
  }

  const outputs = await model!({ pixel_values: new Tensor('float32', input, [1, 3, height, width]) });
  const raw = outputs.predicted_depth ?? Object.values(outputs)[0]!;
  const depth = raw.type === 'float32' ? raw : raw.to('float32');
  const values = depth.data as Float32Array;
  const [outHeight, outWidth] = depth.dims.slice(-2) as [number, number];

  // The model predicts relative inverse depth; stretch it so 0 is the farthest thing in view and 255 the nearest.
  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min || 1;
  const data = new Uint8Array(values.length);

  for (let i = 0; i < values.length; i++) data[i] = Math.round(((values[i]! - min) / range) * 255);

  return { width: outWidth, height: outHeight, data };
}

scope.onmessage = async ({ data: request }) => {
  try {
    if (request.type === 'init') {
      model = await load(request.device);
      scope.postMessage({ type: 'ready' });
    } else {
      const result = await estimate(request.bitmap);

      scope.postMessage({ type: 'depth', id: request.id, ...result }, [result.data.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', id: request.type === 'run' ? request.id : -1, message: String(error) });
  }
};

import { fileURLToPath } from 'node:url';
import { pipeline, RawImage, env } from '@huggingface/transformers';
env.cacheDir = fileURLToPath(new URL('../.local/depth-model-cache/', import.meta.url));
let model;
process.on('message', async ({ id, pixels, width, height }) => {
  try {
    model ||= pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
      dtype: 'fp32', device: 'cpu', revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
    const result = await (await model)(new RawImage(new Uint8Array(pixels), width, height, 3));
    process.send({ id, width: result.depth.width, height: result.depth.height, depth: result.depth.data });
  } catch (error) { model = undefined; process.send({ id, error: error.message }); }
});

process.on('disconnect', () => process.exit(0));

// The QR reader's WebAssembly, served by this app instead of a CDN (the scan page loads it on
// first use in browsers without their own BarcodeDetector). Copied into public/ before builds.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
mkdirSync('public/zxing', { recursive: true });
copyFileSync(source, 'public/zxing/zxing_reader.wasm');

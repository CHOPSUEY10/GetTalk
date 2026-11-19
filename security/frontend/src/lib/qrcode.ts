/**
 * Pure local ISO/IEC 18004 QR Code Generator (Byte Mode, ECC Level L).
 * Renders standards-compliant SVG QR codes directly in the browser without
 * external network calls or third-party dependencies.
 */

type QrVersionSpec = [
  version: number,
  size: number,
  totalDataCodewords: number,
  ecCodewordsPerBlock: number,
  numBlocks: number,
  alignmentCenters: number[],
];

const QR_VERSION_TABLE_L: QrVersionSpec[] = [
  [1, 21, 19, 7, 1, []],
  [2, 25, 34, 10, 1, [6, 18]],
  [3, 29, 55, 15, 1, [6, 22]],
  [4, 33, 80, 20, 1, [6, 26]],
  [5, 37, 108, 26, 1, [6, 30]],
  [6, 41, 136, 18, 2, [6, 34]],
  [7, 45, 156, 20, 2, [6, 22, 38]],
  [8, 49, 194, 24, 2, [6, 24, 42]],
  [9, 53, 232, 30, 2, [6, 26, 46]],
  [10, 57, 274, 18, 4, [6, 28, 50]],
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function reedSolomonEncode(data: Uint8Array, ecLen: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }

  const remainder = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        remainder[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return remainder;
}

export function generateQrCodeMatrix(payload: string): boolean[][] {
  if (!payload || typeof payload !== 'string') {
    throw new Error('QR payload must be a non-empty string.');
  }

  const utf8 = new TextEncoder().encode(payload);

  const spec = QR_VERSION_TABLE_L.find(([ver, , totalData]) => {
    const headerBits = ver <= 9 ? 12 : 20;
    return utf8.length * 8 + headerBits <= totalData * 8;
  });

  if (!spec) {
    throw new Error('QR payload exceeds maximum supported local QR capacity.');
  }

  const [version, size, totalDataCodewords, ecLen, numBlocks, alignCenters] = spec;

  const bits: number[] = [0, 1, 0, 0];
  const countBits = version <= 9 ? 8 : 16;
  for (let i = countBits - 1; i >= 0; i--) {
    bits.push((utf8.length >> i) & 1);
  }
  for (let i = 0; i < utf8.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((utf8[i] >> b) & 1);
    }
  }

  const maxDataBits = totalDataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < maxDataBits; i++) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataBytes = new Uint8Array(totalDataCodewords);
  const filledBytes = bits.length / 8;
  for (let i = 0; i < filledBytes; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataBytes[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = filledBytes; i < totalDataCodewords; i++) {
    dataBytes[i] = padBytes[(i - filledBytes) % 2];
  }

  const blockSize = Math.floor(totalDataCodewords / numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = b === numBlocks - 1 ? totalDataCodewords - offset : blockSize;
    const block = dataBytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonEncode(block, ecLen));
  }

  const finalCodewords: number[] = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      reserved[r][c] = true;
    }
  };

  const placeFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  for (const rCenter of alignCenters) {
    for (const cCenter of alignCenters) {
      if (
        (rCenter === 6 && cCenter === 6) ||
        (rCenter === 6 && cCenter === size - 7) ||
        (rCenter === size - 7 && cCenter === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(rCenter + dr, cCenter + dc, dark);
        }
      }
    }
  }

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  setFunctionModule(size - 8, 8, true);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    }
    const verBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const cw = finalCodewords[bitIdx >> 3];
            dark = ((cw >> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          if ((r + c) % 2 === 0) {
            dark = !dark;
          }
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >> i) & 1) !== 0);
  setFunctionModule(8, 7, ((formatBits >> 6) & 1) !== 0);
  setFunctionModule(8, 8, ((formatBits >> 7) & 1) !== 0);
  setFunctionModule(7, 8, ((formatBits >> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((formatBits >> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((formatBits >> i) & 1) !== 0);

  return modules;
}

export interface QrCodeSvgOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  title?: string;
}

export function generateQrCodeSvg(
  payload: string,
  {
    size = 200,
    margin = 4,
    darkColor = '#0f172a',
    lightColor = '#ffffff',
    title = 'TOTP Authenticator QR Code',
  }: QrCodeSvgOptions = {}
): string {
  const matrix = generateQrCodeMatrix(payload);
  const moduleCount = matrix.length;
  const viewBoxSize = moduleCount + margin * 2;

  const pathSegments: string[] = [];
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        pathSegments.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  const escapedTitle = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" role="img" aria-label="${escapedTitle}" shape-rendering="crispEdges">`,
    `<title>${escapedTitle}</title>`,
    `<rect width="100%" height="100%" fill="${lightColor}" rx="1.5" />`,
    `<path d="${pathSegments.join('')}" fill="${darkColor}" />`,
    `</svg>`,
  ].join('');
}

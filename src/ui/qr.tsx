import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A pairing URI as a QR code, drawn as SVG so it stays sharp and inherits the
 * theme. GESH deliberately returns a string rather than an image, because the
 * application has to append the content key to the fragment first — so drawing
 * it is our job, and it happens here, locally, with nothing fetched.
 */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    // Type 0 lets the encoder pick the smallest version that fits; error
    // correction M survives a phone camera at an angle.
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (code.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), count };
  }, [value]);

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`-1 -1 ${path.count + 2} ${path.count + 2}`}
      role="img"
      aria-label="Pairing QR code"
      shapeRendering="crispEdges"
    >
      <rect x={-1} y={-1} width={path.count + 2} height={path.count + 2} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}

import 'server-only';
import QRCode from 'qrcode-svg';

/**
 * Renders an otpauth:// URI as a self-contained SVG string (no external
 * requests, no client dependency, CSP-safe). The manual setup key is always
 * shown alongside it, so enrollment works even when the QR cannot be scanned.
 */
export function otpauthQrSvg(otpauthUri: string): string {
  return new QRCode({
    content: otpauthUri,
    padding: 2,
    width: 200,
    height: 200,
    color: '#1a1512',
    background: '#ffffff',
    ecl: 'M',
  }).svg();
}

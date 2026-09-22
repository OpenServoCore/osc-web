/** WebUSB is available; `?nousb` forces the unsupported card for review. */
export function usbSupported(nav: { usb?: unknown }, search: string): boolean {
  return nav.usb !== undefined && !new URLSearchParams(search).has("nousb");
}

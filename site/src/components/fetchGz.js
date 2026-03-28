/**
 * Fetch a gzip-compressed file and decompress it if needed.
 * Appends '.gz' to the URL. If the server/browser already decompressed
 * the response (detected via gzip magic number check), returns it as-is.
 */
export async function fetchGz(url) {
  const resp = await fetch(`${url}.gz`);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}.gz: ${resp.status}`);

  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Gzip magic number: 0x1f 0x8b
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable);
  }

  // Already decompressed by server/browser
  return new Response(buf);
}

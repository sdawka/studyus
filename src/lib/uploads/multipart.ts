import { MAX_ATTACHMENT_BYTES, MAX_MULTIPART_OVERHEAD_BYTES } from '../schemas/attachments';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function indexOf(bytes: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function boundaryFrom(contentType: string | null): string | null {
  const match = contentType?.match(/^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  return boundary && boundary.length <= 70 && /^[0-9A-Za-z'()+_,\-./:=?]+$/.test(boundary) ? boundary : null;
}

async function boundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const limit = MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// Accept exactly one `file` part. Reading is bounded before concatenation so
// request Content-Length never decides whether an upload may consume memory.
export async function parseBoundedMultipartFile(request: Request): Promise<File | null> {
  const boundary = boundaryFrom(request.headers.get('content-type'));
  if (!boundary) return null;
  const body = await boundedBody(request);
  if (!body) return null;

  const marker = textEncoder.encode(`--${boundary}`);
  if (indexOf(body, marker) !== 0) return null;
  let cursor = marker.length;
  if (body[cursor] !== 13 || body[cursor + 1] !== 10) return null;
  cursor += 2;

  const headersEnd = indexOf(body, textEncoder.encode('\r\n\r\n'), cursor);
  if (headersEnd === -1 || headersEnd - cursor > MAX_MULTIPART_OVERHEAD_BYTES) return null;
  const headers = textDecoder.decode(body.slice(cursor, headersEnd));
  const disposition = headers.match(/^content-disposition:\s*form-data;\s*name="([^"]+)";\s*filename="([^"]*)"\s*$/im);
  if (!disposition || disposition[1] !== 'file' || !disposition[2]) return null;
  const mediaType = headers.match(/^content-type:\s*([^\r\n;]+(?:;[^\r\n]+)?)\s*$/im)?.[1]?.trim() || 'application/octet-stream';

  const fileStart = headersEnd + 4;
  const nextMarker = textEncoder.encode(`\r\n--${boundary}`);
  const fileEnd = indexOf(body, nextMarker, fileStart);
  if (fileEnd === -1 || fileEnd - fileStart > MAX_ATTACHMENT_BYTES) return null;
  const end = fileEnd + nextMarker.length;
  if (body[end] !== 45 || body[end + 1] !== 45) return null;
  if (end + 2 !== body.length && !(body[end + 2] === 13 && body[end + 3] === 10 && end + 4 === body.length)) return null;

  return new File([body.slice(fileStart, fileEnd)], disposition[2], { type: mediaType });
}

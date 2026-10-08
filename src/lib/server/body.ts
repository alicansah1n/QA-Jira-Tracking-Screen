import "server-only";

export class BodyError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "BodyError";
  }

  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "BodyError";
  }
}

/** JSON gövdeyi bayt sınırıyla okur. Content-Length baştan kontrol edilir; yoksa okunan bayt sayılır. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw tooLarge(maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BodyError(400, "Gövde geçerli JSON değil");
  }
}

function tooLarge(maxBytes: number) {
  return new BodyError(413, `İstek çok büyük (en fazla ${Math.round(maxBytes / 1024)} KB)`);
}

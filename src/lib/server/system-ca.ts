import tls from "node:tls";

let applied = false;

/**
 * İşletim sisteminin güvendiği kök sertifikaları Node'un varsayılan listesine ekler.
 * Şirket ağları HTTPS trafiğini kendi sertifikalarıyla inceleyebilir (TLS inspection); bu durumda
 * Node yalnızca kendi listesini kullandığı için "self-signed certificate in certificate chain" hatası verir.
 */
export function trustSystemCertificates(): void {
  if (applied) return;
  applied = true;
  try {
    const merged = new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
    tls.setDefaultCACertificates([...merged]);
  } catch (error) {
    console.warn("[tls] Sistem sertifikaları yüklenemedi; yalnızca Node'un listesi kullanılacak.", error);
  }
}

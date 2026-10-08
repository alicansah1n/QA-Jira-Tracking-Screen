export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { trustSystemCertificates } = await import("@/lib/server/system-ca");
    trustSystemCertificates();
  }
}

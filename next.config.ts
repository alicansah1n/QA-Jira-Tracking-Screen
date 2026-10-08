import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Kişisel veriler ve sırlar `data/` ve `.env.local` içinde; derlemeye girmemeli.
  outputFileTracingExcludes: { "*": ["./data/**/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              // Uygulama başka bir sayfa içinde çerçevelenemez (clickjacking).
              "frame-ancestors 'none'",
              // Görseller yalnızca Atlassian'ın avatar/ikon sunucularından: Jira'dan gelen keyfi bir
              // adres izleme ya da IP sızdırma için kullanılamaz.
              "img-src 'self' data: https://*.atlassian.net https://*.atl-paas.net https://api.atlassian.com https://secure.gravatar.com https://*.wp.com",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;

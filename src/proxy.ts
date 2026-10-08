import { NextResponse, type NextRequest } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER, evaluateRequest, newCsrfToken } from "@/lib/security/request-guard";

export function proxy(request: NextRequest) {
  const result = evaluateRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    csrfCookie: request.cookies.get(CSRF_COOKIE)?.value,
    csrfHeader: request.headers.get(CSRF_HEADER),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  const response = NextResponse.next();
  if (!request.cookies.has(CSRF_COOKIE)) {
    // İstemci kodu bu değeri okuyup başlık olarak geri gönderir; bu yüzden HttpOnly değildir.
    response.cookies.set(CSRF_COOKIE, newCsrfToken(), { sameSite: "strict", path: "/", httpOnly: false });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

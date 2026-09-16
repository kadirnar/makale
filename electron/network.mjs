import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip);
  return false;
}
export async function checkPublicUrl(input) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("PUBLIC_URL_REQUIRED");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
    throw new Error("PUBLIC_URL_REQUIRED");
  return url;
}
function request(url, signal) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal,
        headers: { "User-Agent": "Makale/1.0 (research article reader)" },
        // Validate the addresses actually used by the socket, preventing DNS rebinding.
        lookup(host, options, callback) {
          dns
            .lookup(host, { all: true })
            .then((addresses) => {
              if (
                !addresses.length ||
                addresses.some((x) => !isPublicAddress(x.address))
              )
                return callback(new Error("PUBLIC_URL_REQUIRED"));
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            })
            .catch(callback);
        },
      },
      resolve,
    );
    req.on("error", reject);
  });
}
export async function fetchArticle(input, signal) {
  let url = await checkPublicUrl(input);
  const combined = AbortSignal.any([
    AbortSignal.timeout(45000),
    ...(signal ? [signal] : []),
  ]);
  for (let n = 0; n < 6; n++) {
    const response = await request(url, combined);
    if (response.statusCode >= 300 && response.statusCode < 400) {
      response.destroy();
      url = await checkPublicUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new Error(`ARTICLE_HTTP_${response.statusCode}`);
    }
    const max = 30 * 1024 * 1024;
    if (Number(response.headers["content-length"]) > max) {
      response.destroy();
      throw new Error("FILE_TOO_LARGE");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > max) {
        response.destroy();
        throw new Error("FILE_TOO_LARGE");
      }
      chunks.push(chunk);
    }
    return {
      bytes: Buffer.concat(chunks),
      type: response.headers["content-type"] || "",
      url: url.href,
    };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

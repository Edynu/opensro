/*
===========================================================================

Probe Endpoint Configuration

One owner for the browser and Agent endpoints used by live probes. A probe
may choose a stack through environment variables, but it must not embed
ports or quietly fall back to a different service.

===========================================================================
*/

function resolveHttpBaseUrl(environmentName, fallback) {
  const configured = process.env[environmentName]?.trim() || fallback;
  let parsed;

  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`${environmentName} is not a valid absolute URL: ${configured}`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      `${environmentName} must be an HTTP(S) origin without credentials, query, or fragment`
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export const CLIENT_LOOPBACK_HOST = "127.0.0.1";
export const CLIENT_DEV_PORT = 5174;
export const CLIENT_PROD_PORT = 4173;
export const CLIENT_DEV_BASE_URL = `http://${CLIENT_LOOPBACK_HOST}:${CLIENT_DEV_PORT}`;
export const CLIENT_PROD_BASE_URL = `http://${CLIENT_LOOPBACK_HOST}:${CLIENT_PROD_PORT}`;
export const CLIENT_NEXT_BASE_URL = resolveHttpBaseUrl(
  "SRO_PROBE_CLIENT_NEXT_BASE_URL",
  `http://${CLIENT_LOOPBACK_HOST}:5180`
);

export const CLIENT_BASE_URL = resolveHttpBaseUrl(
  "SRO_PROBE_CLIENT_BASE_URL",
  CLIENT_DEV_BASE_URL
);

export const AGENT_API_BASE_URL = resolveHttpBaseUrl(
  "SRO_PROBE_AGENT_BASE_URL",
  "http://127.0.0.1:8787"
);

export function probeClientUrl(query = "") {
  const normalized = query.replace(/^[?&]+/, "");
  return normalized === "" ? `${CLIENT_BASE_URL}/` : `${CLIENT_BASE_URL}/?${normalized}`;
}

export function probeAgentUrl(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error(`probe Agent path must start with exactly one slash: ${pathname}`);
  }
  return `${AGENT_API_BASE_URL}${pathname}`;
}

// A stand-in for an internal-only service (think cloud metadata endpoint).
// SSRF probes target THIS so the intentionally-vulnerable app never touches
// the host's real network. The sentinel string is what proves a server-side
// fetch reached somewhere the attacker could not reach directly.

export const INTERNAL_SENTINEL = "INTERNAL-ONLY-IMDS-TOKEN-9f3a1c";

export function startMockInternal(port = 9099) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch() {
      return new Response(
        JSON.stringify({ role: "arena-internal", token: INTERNAL_SENTINEL }),
        { headers: { "content-type": "application/json" } }
      );
    },
  });
  return {
    url: `http://127.0.0.1:${port}/latest/meta-data/iam/security-credentials/`,
    stop: () => server.stop(true),
  };
}

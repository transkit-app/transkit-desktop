/**
 * DEPRECATED — use get-cloud-credentials instead.
 *
 * This function was the original Deepgram-only credential endpoint.
 * It has been superseded by get-cloud-credentials which supports all
 * providers (Deepgram, Soniox, Gladia) with unified quota enforcement.
 *
 * Returns 410 Gone so any stale client integration fails loudly rather
 * than bypassing the new quota logic silently.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({
      error: 'endpoint_removed',
      detail: 'Use get-cloud-credentials instead.',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
)

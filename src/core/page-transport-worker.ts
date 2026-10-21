// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

/**
 * Self-contained JavaScript for a disposable Node process. Keeping the worker
 * inside a compiled module avoids a second asset/loader path in native source,
 * native dist and the standalone bundles. The installed dependency URL is an
 * argument; request/proxy values travel over private IPC, never command argv.
 *
 * Native wreq cancellation is not our settlement witness. This process owns one
 * entire request/redirect/body chain and always exits, including natural EOF.
 */
export const pageTransportWorker = String.raw`
const send = (message) => new Promise((resolve, reject) => {
  if (!process.connected) return reject(new Error('IPC closed'));
  process.send(message, (error) => error ? reject(error) : resolve());
});
const validUrl = (value) => {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('URL');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('URL');
  return parsed.href;
};
let started = false;
let busy = false;
let reader;
let session;
let complete = false;
const finish = async (message, code) => {
  if (complete) return;
  complete = true;
  try {
    await session?.close();
    await send(message);
  } finally { process.exit(code); }
};
process.on('disconnect', () => process.exit(1));
process.on('message', async (message) => {
  if (complete) return;
  try {
    if (message?.type === 'start' && !started) {
      started = true;
      busy = true;
      let createSession;
      try { ({ createSession } = await import(process.argv[1])); }
      catch { await finish({ type: 'failure', code: 'DEPENDENCY_UNAVAILABLE' }, 1); return; }
      session = await createSession({ browser: message.browser, os: 'windows',
        ...(message.proxy === undefined ? {} : { proxy: message.proxy }) });
      let url = validUrl(message.url);
      const headers = { ...message.headers };
      let response;
      // Match wreq's ten-redirect chain limit. Manual following allows URL
      // validation before each hop, including relative Location values.
      for (let redirects = 0; ; redirects++) {
        response = await session.fetch(url, {
          method: message.method,
          headers,
          redirect: 'manual',
        });
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
        if (redirects >= 10) throw new Error('Redirect limit');
        if (/[\u0000-\u001f\u007f]/.test(location)) throw new Error('Redirect URL');
        const next = validUrl(new URL(location, url).href);
        if (new URL(next).origin !== new URL(url).origin) {
          for (const name of Object.keys(headers)) {
            if (['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())) delete headers[name];
          }
        }
        // Match installed follow mode, not an assumed browser referrer policy:
        // replace even an explicit Referer with the preceding full URL, omit
        // fragments and suppress HTTPS-to-HTTP downgrade disclosure.
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'referer') delete headers[name];
        }
        if (!(new URL(url).protocol === 'https:' && new URL(next).protocol === 'http:')) {
          const referer = new URL(url);
          referer.hash = '';
          headers.Referer = referer.href;
        }
        url = next;
        // Native reads/cache entries can outlive this JS cancellation. They
        // remain inside this same owned child until its mandatory exit.
        await response.body?.cancel();
      }
      const body = response.body;
      reader = body?.getReader();
      busy = false;
      await send({ type: 'headers', status: response.status, url: validUrl(response.url),
        headers: Array.from(response.headers), hasBody: body !== null });
      if (!reader) await finish({ type: 'end' }, 0);
    } else if (message?.type === 'read' && started && !busy && reader) {
      busy = true;
      while (true) {
        const { value, done } = await reader.read();
        if (done) { await finish({ type: 'end' }, 0); return; }
        if (value.byteLength === 0) continue;
        // A reply can arrive before this IPC callback completes. The native
        // read is already finished; do not reject that legitimate next pull.
        busy = false;
        await send({ type: 'chunk', value });
        break;
      }
    } else {
      throw new Error('Protocol');
    }
  } catch {
    // Dependency messages can contain proxy credentials or response content.
    // Send a fixed diagnostic, not native errors or captured stderr.
    await finish({ type: 'failure', code: 'REQUEST_FAILED' }, 1);
  }
});
`;

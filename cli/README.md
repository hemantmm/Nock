# hooktrace

Forward HookTrace captures to a server on your machine. The command preserves the raw body, so a Stripe, GitHub, or Razorpay signature still verifies locally. The server's SSRF guard does not apply here: the request leaves your computer, not HookTrace.

```bash
npm install
npm run build
hooktrace login --email you@example.com --password "$HOOKTRACE_PASSWORD"
hooktrace listen ep_… --forward http://localhost:3000/webhooks
```

`HOOKTRACE_URL` (default `http://localhost:4317`) is the HookTrace server. `HOOKTRACE_TOKEN` is the endpoint owner token. You can also pass `--token`, or an inbox URL that ends in `#t=<token>`. Copy the token from inbox settings.

```bash
hooktrace listen ep_… --port 3000 --path /webhooks
hooktrace replay evt_… --forward http://localhost:3000/webhooks
```

`--json` prints one object per event. The process reconnects with backoff and sends `Last-Event-ID` so a dropped stream does not skip a delivery. Ctrl+C stops it.

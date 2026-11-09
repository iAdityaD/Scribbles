# Server deployment

1. Build the root Dockerfile and run one instance with port 3001 exposed, or use the `render.yaml` blueprint. The blueprint selects a free instance for private friend-group testing. [Deploy the Scribbles backend on Render](https://render.com/deploy?repo=https://github.com/iAdityaD/Scribbles). Sign in to Render and connect this repository. Copy the HTTPS address assigned to the web service after its health check succeeds. Free instances can sleep while idle and take time to wake.
2. Put the service behind HTTPS with WebSocket upgrade support. Configure a proxy idle timeout above the Socket.IO ping interval (e.g. 90 seconds). Do not enable multiple replicas: rooms are process-local.
3. Set `ALLOWED_ORIGINS` to comma-separated web origins if using web clients. Native clients do not use browser CORS. Do not mistake CORS for authentication.
   - `ROOM_CREATE_LIMIT` (default 6) caps rooms created per client address per 10 minutes.
   - Set `TRUST_PROXY=1` only when exactly one trusted proxy sits in front of the server (the Render blueprint does this), so the limit uses the real client address from `X-Forwarded-For`. Leave it unset when clients connect directly, or anyone could fake their address.
4. Verify `GET /health` returns `{"ok":true,"rooms":0}` before inviting players.
5. Set `EXPO_PUBLIC_SERVER_URL=https://your-host` in your mobile build environment. For GitHub Actions builds, set the repository Actions variable `SCRIBBLES_SERVER_URL` to that HTTPS origin. Alternatively, the host can enter it in Android Settings, then share an invite containing both the server and room code. A friend can open the invite or paste it on the join screen and confirm the server. The URL is public configuration, not a secret.
6. Test two physical devices on different networks: room join, live drawing, guesses, chat, reconnect, rematch.

Local container example (after configuring your Docker environment):

```bash
docker build -t scribbles-server .
docker run --rm -p 3001:3001 -e ALLOWED_ORIGINS=http://localhost:8081 scribbles-server
```

## Operations

Deployments interrupt active matches because room state is not persistent. Schedule updates outside active game sessions. The server logs unexpected processing errors; do not add logs containing reconnect tokens, secret words or full chat payloads.

Bounded payloads, message/stroke limits and socket command throttling reduce accidental load. Before opening the service to an untrusted large audience, add ingress connection/IP limits and monitoring. Reconnect tokens are bearer capabilities stored locally by the guest app; anyone with that token can resume that seat. There are no user accounts or durable chat archives.

## Scaling follow-up

Persist room snapshots and command deduplication with TTLs, assign one owner per room, and use an adapter compatible with the chosen recovery model before adding replicas. A plain Redis broadcast adapter alone does not make this in-memory game state multi-instance safe.

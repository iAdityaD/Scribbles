export type OnlineInvite = {code: string; server?: string};

/** Socket.IO uses the origin for its default namespace and /socket.io path. */
export function serverOrigin(value: string, development = false): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' && !(development && url.protocol === 'http:')) {
    throw new Error('Enter the HTTPS address of the Scribbles server.');
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use the server address without a path, credentials or query.');
  }
  return url.origin;
}

export function onlineInviteLink(code: string, server: string): string {
  const base = 'scribbles://join/' + code;
  try { return base + '?server=' + encodeURIComponent(serverOrigin(server)); }
  catch { return base; } // Local development and older clients can still use the code.
}

export function parseOnlineInvite(link: string): OnlineInvite | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'scribbles:' || url.hostname !== 'join' || url.username || url.password || url.port) return null;
    const code = url.pathname.slice(1).toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return null;
    const server = url.searchParams.get('server');
    return server === null ? {code} : {code, server:serverOrigin(server)};
  } catch { return null; }
}

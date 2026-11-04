export function createPeer(iceServers:RTCIceServer[]):RTCPeerConnection {
  if(typeof RTCPeerConnection==='undefined')throw Error('This device does not support internet peer rooms.');
  return new RTCPeerConnection({iceServers});
}

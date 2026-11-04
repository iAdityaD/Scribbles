import { RTCPeerConnection as NativePeer } from 'react-native-webrtc';
// Only the shared WebRTC data-channel APIs are used, no media tracks.
export function createPeer(iceServers:RTCIceServer[]):RTCPeerConnection {
  return new NativePeer({iceServers}) as unknown as RTCPeerConnection;
}

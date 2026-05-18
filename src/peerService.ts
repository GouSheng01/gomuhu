import { Peer } from 'peerjs';
import type { PeerAction } from './types';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

let peer: Peer | null = null;
let conn: any = null;
let statusCallback: ((s: ConnectionStatus) => void) | null = null;
let actionCallback: ((action: PeerAction) => void) | null = null;

export function getConnection(): any | null {
  return conn;
}

export function onStatusChange(cb: (s: ConnectionStatus) => void) {
  statusCallback = cb;
}

export function onRemoteAction(cb: (action: PeerAction) => void) {
  actionCallback = cb;
}

function setStatus(s: ConnectionStatus) {
  statusCallback?.(s);
}

/** Create a room with a custom room ID. Host plays black. */
export function createRoom(roomId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    setStatus('connecting');
    peer = new Peer(roomId, { debug: 0, config: ICE_SERVERS });

    peer.on('open', (id: string) => {
      console.log('[peer] room created:', id);
      // Wait for guest to connect
      peer!.on('connection', (incoming: any) => {
        conn = incoming;
        setupConnection();
        setStatus('connected');
      });
      resolve(id);
    });

    peer.on('error', (err: Error) => {
      console.error('[peer] error:', err);
      setStatus('disconnected');
      reject(err);
    });

    peer.on('disconnected', () => {
      setStatus('disconnected');
      peer?.reconnect();
    });
  });
}

/** Join a room by room ID. Guest plays white. */
export function joinRoom(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    setStatus('connecting');
    peer = new Peer({ debug: 0, config: ICE_SERVERS });

    // Timeout: if connection doesn't establish within 20s, give up
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.error('[peer] connection timeout');
        setStatus('disconnected');
        reject(new Error('连接超时，请检查房间号是否正确'));
        peer?.destroy();
      }
    }, 20000);

    peer.on('open', () => {
      console.log('[peer] joining room:', roomId);
      conn = peer!.connect(roomId, { reliable: true });

      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.log('[peer] connected to host');
        setupConnection();
        setStatus('connected');
        resolve();
      });

      conn.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.error('[peer] connection error:', err);
        setStatus('disconnected');
        reject(err);
      });
    });

    peer.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error('[peer] error:', err);
      setStatus('disconnected');
      reject(err);
    });

    peer.on('disconnected', () => {
      if (!settled) setStatus('disconnected');
    });
  });
}

function setupConnection() {
  if (!conn) return;
  conn.on('data', (data: unknown) => {
    console.log('[peer] received:', data);
    actionCallback?.(data as PeerAction);
  });
  conn.on('close', () => {
    console.log('[peer] connection closed');
    setStatus('disconnected');
  });
  conn.on('error', (err: Error) => {
    console.error('[peer] conn error:', err);
  });
}

/** Send an action to the remote peer. */
export function sendAction(action: PeerAction) {
  if (conn && conn.open) {
    console.log('[peer] sending:', action);
    conn.send(action);
  }
}

/** Clean up peer connection. */
export function disconnect() {
  conn?.close();
  peer?.destroy();
  conn = null;
  peer = null;
  setStatus('idle');
}

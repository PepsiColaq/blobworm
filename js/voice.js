/**
 * Mesh WebRTC voice + уровень голоса + слышимость по FOV.
 */
export function createVoiceChat({ net, getLocalId, getDeviceId }) {
  const peers = new Map(); // id -> { pc, stream, el, analyser, data, audible }
  let localStream = null;
  let muted = true;
  let enabled = false;
  let audioCtx = null;
  let localAnalyser = null;
  let localData = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function makeAnalyser(stream) {
    const ctx = ensureAudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    return { analyser, data };
  }

  function readLevel(analyser, data) {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 3.2);
  }

  async function ensureMic(forceRestart = false) {
    if (localStream && !forceRestart) return localStream;
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      localAnalyser = null;
      localData = null;
    }
    const deviceId = getDeviceId?.();
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    }
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    try {
      const a = makeAnalyser(localStream);
      localAnalyser = a.analyser;
      localData = a.data;
    } catch {
      /* analyser optional */
    }
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      const track = localStream.getAudioTracks()[0];
      if (sender && track) sender.replaceTrack(track);
    }
    return localStream;
  }

  function attachAudio(id, stream) {
    let el = document.getElementById('voice-audio-' + id);
    if (!el) {
      el = document.createElement('audio');
      el.id = 'voice-audio-' + id;
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.volume = 1;
      document.body.appendChild(el);
    }
    el.srcObject = stream;
    el.play?.().catch(() => {});
    const entry = peers.get(id);
    if (entry) {
      entry.stream = stream;
      entry.el = el;
      try {
        const a = makeAnalyser(stream);
        entry.analyser = a.analyser;
        entry.data = a.data;
      } catch {
        /* ignore */
      }
      // в комнате по умолчанию слышим (FOV больше не глушит)
      entry.audible = true;
      applyAudible(id);
    }
  }

  function applyAudible(id) {
    const entry = peers.get(id);
    if (!entry?.el) return;
    entry.el.volume = entry.audible ? 1 : 0;
    entry.el.muted = !entry.audible;
    if (entry.audible) entry.el.play?.().catch(() => {});
  }

  async function createPeer(remoteId, polite) {
    if (peers.has(remoteId)) return peers.get(remoteId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    });
    const entry = {
      pc,
      makingOffer: false,
      stream: null,
      el: null,
      analyser: null,
      data: null,
      audible: true,
    };
    peers.set(remoteId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) net.signalVoice(remoteId, { candidate: e.candidate });
    };
    pc.ontrack = (e) => attachAudio(remoteId, e.streams[0]);

    const stream = await ensureMic();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    if (!polite) {
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      net.signalVoice(remoteId, { sdp: pc.localDescription });
      entry.makingOffer = false;
    }
    return entry;
  }

  async function onSignal(from, data) {
    if (!enabled) return;
    let entry = peers.get(from);
    if (!entry) entry = await createPeer(from, true);
    const pc = entry.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          net.signalVoice(from, { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.warn('voice signal', err);
    }
  }

  async function syncPeers(peerList) {
    if (!enabled) return;
    const me = getLocalId();
    const ids = peerList.map((p) => p.id).filter((id) => id !== me);
    for (const id of ids) {
      if (!peers.has(id)) {
        const polite = String(me) > String(id);
        await createPeer(id, polite);
      }
    }
    for (const id of [...peers.keys()]) {
      if (!ids.includes(id)) {
        peers.get(id).pc.close();
        peers.delete(id);
        document.getElementById('voice-audio-' + id)?.remove();
      }
    }
  }

  return {
    async listMics() {
      try {
        if (!localStream) {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
          tmp.getTracks().forEach((t) => t.stop());
        }
      } catch {
        /* ignore */
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    },
    async enable() {
      enabled = true;
      muted = false;
      try {
        ensureAudioCtx();
        await ensureMic(true);
        return true;
      } catch {
        enabled = false;
        return false;
      }
    },
    disable() {
      enabled = false;
      muted = true;
      for (const { pc } of peers.values()) pc.close();
      peers.clear();
      localStream?.getTracks().forEach((t) => t.stop());
      localStream = null;
      localAnalyser = null;
      localData = null;
      document.querySelectorAll('[id^="voice-audio-"]').forEach((el) => el.remove());
    },
    async setDeviceId() {
      try {
        if (enabled) await ensureMic(true);
      } catch (e) {
        console.warn(e);
      }
    },
    setMuted(v) {
      muted = v;
      localStream?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    },
    toggleMuted() {
      this.setMuted(!muted);
      return muted;
    },
    isMuted: () => muted,
    isEnabled: () => enabled,
    /** локальный уровень 0..1 (если мут — 0) */
    getLocalLevel() {
      if (!enabled || muted) return 0;
      return readLevel(localAnalyser, localData);
    },
    getRemoteLevel(id) {
      const e = peers.get(id);
      if (!e) return 0;
      return readLevel(e.analyser, e.data);
    },
    /** слышимость удалённого (в мультиплеере лучше всегда true) */
    setPeerAudible(id, audible) {
      const e = peers.get(id);
      if (!e) return;
      e.audible = !!audible;
      applyAudible(id);
    },
    /** включить звук у всех пиров (после жеста пользователя) */
    unlockAudio() {
      ensureAudioCtx();
      for (const [id, e] of peers) {
        e.audible = true;
        applyAudible(id);
      }
    },
    getPeerIds: () => [...peers.keys()],
    onSignal,
    syncPeers,
  };
}

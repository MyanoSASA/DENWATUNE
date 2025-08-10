(() => {
  // Web Audio ベースの DTMF / ぷー 発音エンジン
  class ToneEngine {
    constructor() {
      /** @type {AudioContext | null} */
      this.audioContext = null;
      /** @type {GainNode | null} */
      this.masterGain = null;
      /** @type {GainNode | null} */
      this.toneGain = null; // 個別トーン用ゲイン（ケイデンス制御）
      /** @type {OscillatorNode | null} */
      this.oscA = null; // 低周波数（DTMF低群 or ぷー）
      /** @type {OscillatorNode | null} */
      this.oscB = null; // 高周波数（DTMF高群）

      this.currentKey = null;
      this.isStarted = false;
      this.masterVolume = 0.3;
      /** @type {number | null} */
      this.cadenceTimeoutId = null; // ケイデンスの次フェーズ予約
      /** @type {'us'|'jp'} */
      this.dialPreset = 'us'; // ダイヤルトーンの地域設定
    }

    ensureContext() {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterGain.connect(this.audioContext.destination);
      }
      if (this.audioContext.state === 'suspended') {
        // ユーザー操作により resume 可能
        this.audioContext.resume();
      }
    }

    setVolume(volume) {
      this.masterVolume = volume;
      if (this.masterGain) {
        this.masterGain.gain.value = volume;
      }
    }

    /**
     * ダイヤルトーンの地域プリセットを設定する
     * @param {'us'|'jp'} preset
     */
    setDialPreset(preset) {
      this.dialPreset = preset;
    }

    // キーに対応する周波数を返す。
    // '*' は米国式のダイヤルトーン（350 Hz + 440 Hz 連続）。
    // '/' は米国式の通話切断（ファストビジー：480 Hz + 620 Hz、0.25s/0.25s）
    getFrequenciesForKey(key) {
      const dtmfLow = { '1': 697, '2': 697, '3': 697, '4': 770, '5': 770, '6': 770, '7': 852, '8': 852, '9': 852, '*': 941, '0': 941, '#': 941 };
      const dtmfHigh = { '1': 1209, '2': 1336, '3': 1477, '4': 1209, '5': 1336, '6': 1477, '7': 1209, '8': 1336, '9': 1477, '*': 1209, '0': 1336, '#': 1477 };

      if (key === '*') {
        if (this.dialPreset === 'jp') {
          // 日本式: 400 Hz 連続（代表値）
          return { a: 400, b: null, isContinuous: true, cadence: null };
        }
        // 米国式: 350 Hz + 440 Hz 連続
        return { a: 350, b: 440, isContinuous: true, cadence: null };
      }

      if (key === '/') {
        return { a: 480, b: 620, isContinuous: false, cadence: { onMs: 250, offMs: 250 } };
      }

      const low = dtmfLow[key];
      const high = dtmfHigh[key];
      if (!low || !high) return null;
      return { a: low, b: high, isContinuous: false, cadence: null };
    }

    startToneForKey(key) {
      const spec = this.getFrequenciesForKey(key);
      if (!spec) return;

      this.ensureContext();
      if (!this.audioContext || !this.masterGain) return;

      this.stopTone();

      // トーン用ゲイン（ケイデンス制御のため master の手前に挿入）
      this.toneGain = this.audioContext.createGain();
      this.toneGain.gain.value = 1;
      this.toneGain.connect(this.masterGain);

      this.oscA = this.audioContext.createOscillator();
      this.oscA.type = 'sine';
      this.oscA.frequency.value = spec.a;
      this.oscA.connect(this.toneGain);
      this.oscA.start();

      if (spec.b) {
        this.oscB = this.audioContext.createOscillator();
        this.oscB.type = 'sine';
        this.oscB.frequency.value = spec.b;
        this.oscB.connect(this.toneGain);
        this.oscB.start();
      }

      this.currentKey = key;
      this.isStarted = true;

      // ケイデンス（オン/オフ繰り返し）が指定されている場合はトーンゲインをトグル
      if (spec.cadence && this.audioContext && this.toneGain) {
        const { onMs, offMs } = spec.cadence;
        const toggle = (isOn) => {
          if (!this.audioContext || !this.toneGain) return;
          const now = this.audioContext.currentTime;
          this.toneGain.gain.cancelScheduledValues(now);
          this.toneGain.gain.setValueAtTime(isOn ? 1 : 0, now);
          const nextDelay = isOn ? onMs : offMs;
          this.cadenceTimeoutId = window.setTimeout(() => toggle(!isOn), nextDelay);
        };
        toggle(true);
      }
    }

    stopTone() {
      if (!this.isStarted) return;
      const now = this.audioContext ? this.audioContext.currentTime : 0;
      if (this.cadenceTimeoutId !== null) {
        try { clearTimeout(this.cadenceTimeoutId); } catch (_) {}
        this.cadenceTimeoutId = null;
      }
      if (this.oscA) {
        try { this.oscA.stop(now); } catch (_) {}
        try { this.oscA.disconnect(); } catch (_) {}
      }
      if (this.oscB) {
        try { this.oscB.stop(now); } catch (_) {}
        try { this.oscB.disconnect(); } catch (_) {}
      }
      if (this.toneGain) {
        try { this.toneGain.disconnect(); } catch (_) {}
      }
      this.oscA = null;
      this.oscB = null;
      this.toneGain = null;
      this.isStarted = false;
      this.currentKey = null;
    }
  }

  const engine = new ToneEngine();

  // UI 要素
  const modeRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="mode"]'));
  const durationSlider = /** @type {HTMLInputElement} */ (document.getElementById('duration'));
  const durationOut = /** @type {HTMLOutputElement} */ (document.getElementById('durationOut'));
  const volumeSlider = /** @type {HTMLInputElement} */ (document.getElementById('volume'));
  const volumeOut = /** @type {HTMLOutputElement} */ (document.getElementById('volumeOut'));
  const dialPresetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('dialPreset'));
  const gapSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('gap'));
  const gapOut = /** @type {HTMLOutputElement | null} */ (document.getElementById('gapOut'));
  const playSeqBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('playSeq'));
  const stopSeqBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('stopSeq'));
  const seqInput = /** @type {HTMLInputElement | null} */ (document.getElementById('seqInput'));
  const inputLog = /** @type {HTMLSpanElement} */ (document.getElementById('inputLog'));
  const currentKeyEl = /** @type {HTMLSpanElement} */ (document.getElementById('currentKey'));
  const statusEl = /** @type {HTMLSpanElement} */ (document.getElementById('status'));
  const keypad = /** @type {HTMLElement} */ (document.querySelector('.keypad__grid'));

  let mode = 'hold'; // 'hold' | 'auto'
  let autoDurationMs = Number(durationSlider.value);
  let gapMs = gapSlider ? Number(gapSlider.value) : 60;

  /** @type {number | null} */
  let seqTimer = null;
  /** @type {string[]} */
  let seqBuffer = [];
  /** 再生中フラグ */
  let isSeqPlaying = false;

  function setStatus(text) { statusEl.textContent = text; }
  function setCurrentKey(text) { currentKeyEl.textContent = text || '—'; }
  function appendLog(k) {
    inputLog.textContent = (inputLog.textContent + k).slice(-24);
  }

  durationOut.textContent = `${autoDurationMs} ms`;
  volumeOut.textContent = `${Math.round(Number(volumeSlider.value) * 100)}%`;
  if (gapOut && gapSlider) gapOut.textContent = `${gapMs} ms`;

  // モード切替
  modeRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        mode = r.value;
        setStatus(mode === 'hold' ? '押している間だけ鳴る' : `自動 ${autoDurationMs}ms`);
      }
    });
  });

  // スライダー
  durationSlider.addEventListener('input', () => {
    autoDurationMs = Number(durationSlider.value);
    durationOut.textContent = `${autoDurationMs} ms`;
    if (mode === 'auto') setStatus(`自動 ${autoDurationMs}ms`);
  });

  volumeSlider.addEventListener('input', () => {
    engine.setVolume(Number(volumeSlider.value));
    volumeOut.textContent = `${Math.round(Number(volumeSlider.value) * 100)}%`;
  });

  // シーケンス間隔
  if (gapSlider && gapOut) {
    gapSlider.addEventListener('input', () => {
      gapMs = Number(gapSlider.value);
      gapOut.textContent = `${gapMs} ms`;
    });
  }

  function cancelSequencePlayback() {
    if (seqTimer !== null) {
      try { clearTimeout(seqTimer); } catch(_) {}
      seqTimer = null;
    }
    isSeqPlaying = false;
  }

  function scheduleNextFromBuffer() {
    if (!isSeqPlaying) return;
    if (seqBuffer.length === 0) {
      isSeqPlaying = false;
      setStatus('待機中');
      return;
    }
    const k = seqBuffer.shift();
    if (!k) return scheduleNextFromBuffer();
    // 受け付け可能キーのみ再生
    if (!validKeys.has(k)) return scheduleNextFromBuffer();

    // auto モードでの単発再生に合わせる（DTMF:トーン長 autoDurationMs + 間隔 gapMs）
    const playOnce = () => {
      engine.startToneForKey(k);
      const localK = k;
      setStatus('再生中');
      window.setTimeout(() => {
        if (engine.currentKey === localK) {
          engine.stopTone();
          setCurrentKey('—');
        }
        // 次のキーへ
        seqTimer = window.setTimeout(scheduleNextFromBuffer, gapMs);
      }, autoDurationMs);
    };

    setCurrentKey(k);
    appendLog(k);
    // UI ハイライト
    const btn = document.querySelector(`.key[data-key="${CSS.escape(k)}"]`);
    btn && btn.classList.add('is-active');
    playOnce();
    // 終了時にハイライト解除
    window.setTimeout(() => { btn && btn.classList.remove('is-active'); }, autoDurationMs + 10);
  }

  function startSequencePlaybackFromText() {
    // 入力欄から再生
    const raw = seqInput ? seqInput.value : '';
    const input = (raw || '').slice(0, 128); // 念のため上限
    seqBuffer = input.split('');
    if (seqBuffer.length === 0) return;
    cancelSequencePlayback();
    isSeqPlaying = true;
    scheduleNextFromBuffer();
  }

  // 編集可能要素にフォーカスがある場合はキーボード入力を無視
  function isFromEditableTarget(ev) {
    const t = ev.target;
    const isElEditable = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLInputElement) return true;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLSelectElement) return true;
      return false;
    };
    if (isElEditable(t)) return true;
    const ae = document.activeElement;
    if (isElEditable(ae)) return true;
    return false;
  }

  // ダイヤルトーン プリセット
  if (dialPresetSelect) {
    engine.setDialPreset(dialPresetSelect.value === 'jp' ? 'jp' : 'us');
    dialPresetSelect.addEventListener('change', () => {
      const preset = dialPresetSelect.value === 'jp' ? 'jp' : 'us';
      engine.setDialPreset(preset);
      // 再生中に切替えた場合、'*' を即時再起動して反映
      if (engine.currentKey === '*' && engine.isStarted) {
        engine.startToneForKey('*');
      }
    });
  }

  // 発音制御
  function triggerKeyDown(k) {
    const btn = document.querySelector(`.key[data-key="${CSS.escape(k)}"]`);
    btn && btn.classList.add('is-active');
    setCurrentKey(k);
    appendLog(k);

    if (mode === 'hold') {
      engine.startToneForKey(k);
    } else {
      engine.startToneForKey(k);
      setStatus('再生中');
      const localKey = k;
      setTimeout(() => {
        if (engine.currentKey === localKey) {
          engine.stopTone();
          setCurrentKey('—');
          setStatus(`自動 ${autoDurationMs}ms`);
          btn && btn.classList.remove('is-active');
        }
      }, autoDurationMs);
    }
  }

  function triggerKeyUp(k) {
    const btn = document.querySelector(`.key[data-key="${CSS.escape(k)}"]`);
    btn && btn.classList.remove('is-active');
    if (mode === 'hold' && engine.currentKey === k) {
      engine.stopTone();
      setCurrentKey('—');
      setStatus('待機中');
    }
  }

  // クリック UI
  keypad.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const key = target.getAttribute('data-key');
    if (!key) return;
    triggerKeyDown(key);

    const up = () => {
      triggerKeyUp(key);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('pointerleave', up);
    };
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    window.addEventListener('pointerleave', up, { once: true });
  });

  // キーボード
  const validKeys = new Set(['0','1','2','3','4','5','6','7','8','9','#','*','/']);
  const pressedKeys = new Set();

  window.addEventListener('keydown', (e) => {
    if (isFromEditableTarget(e)) return;
    const k = e.key;
    if (!validKeys.has(k)) return;
    // 手動操作が入ったらシーケンス再生をキャンセル
    if (isSeqPlaying) cancelSequencePlayback();
    if (pressedKeys.has(k) && mode === 'hold') return; // リピート抑止
    pressedKeys.add(k);
    e.preventDefault();
    triggerKeyDown(k);
  });

  window.addEventListener('keyup', (e) => {
    if (isFromEditableTarget(e)) return;
    const k = e.key;
    if (!validKeys.has(k)) return;
    pressedKeys.delete(k);
    e.preventDefault();
    triggerKeyUp(k);
  });

  // シーケンス制御ボタン
  if (playSeqBtn) {
    playSeqBtn.addEventListener('click', () => {
      startSequencePlaybackFromText();
    });
  }
  if (stopSeqBtn) {
    stopSeqBtn.addEventListener('click', () => {
      cancelSequencePlayback();
      setStatus('停止');
    });
  }
})();


// ============================================================================
// AFINADOR PROFESIONAL DE ALTA PRECISIÓN (Algoritmo YIN + Medidor Sweet Spot)
// ============================================================================

// --- CONFIGURACIÓN PRINCIPAL ---
let A4_FREQUENCY = 442; // Calibración inicial (442 Hz orquestal)
const NOTE_STRINGS = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const FREQ_TOLERANCE_HZ = 10.0; // Tolerancia de 10 Hz de cada lado del cero
const CENTS_TOLERANCE_DIAL = 10.0; // Tolerancia de 10 en la escala del dial

// --- VARIABLES DE ESTADO Y AUDIO ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let lowPassFilter = null;
let highPassFilter = null;
let animationId = null;

// Variables de física de la aguja y filtrado
let currentCents = 0;
let targetCents = 0;
let hasActiveSignal = false;
let framesWithoutSignal = 0;
let smoothedFreq = 0;
let isCurrentlyTuned = false;
// El afinador siempre detecta automáticamente la nota que suena.
let selectedNoteIndex = 9; // Por defecto La (A4)
let activeOctave = 4;      // Octava 4
let isPlayingTone = false;
let toneOscillator = null;
let toneGain = null;

// Elementos del DOM
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnTestTone = document.getElementById('btn-test-tone');
const btnCalibration = document.getElementById('btn-calibration');
const calFreqDisplay = document.getElementById('cal-freq');
const menuCalFreqDisplay = document.getElementById('menu-cal-freq');
const btnTuneDown = document.getElementById('btn-tune-down');
const btnTuneUp = document.getElementById('btn-tune-up');

// Elementos de Selección de Nota a Afinar y Escuchar
const btnListenActiveNote = document.getElementById('btn-listen-active-note');
const listenBtnLabel = document.getElementById('listen-btn-label');
const octaveButtons = document.querySelectorAll('.octave-btn');
const noteKeys = document.querySelectorAll('.note-key');

const noteName = document.getElementById('note-name');
const noteOctave = document.getElementById('note-octave');
const centsPill = document.getElementById('cents-pill');
const tuningStatus = document.getElementById('tuning-status');

const guideFlat = document.getElementById('guide-flat');
const guideCenter = document.getElementById('guide-center');
const guideSharp = document.getElementById('guide-sharp');
const tunerDashboard = document.querySelector('.tuner-dashboard');
const noteContainer = document.querySelector('.note-container');

const freqDisplay = document.getElementById('freq-display');
const centsDisplay = document.getElementById('cents-display');
const hzDiffDisplay = document.getElementById('hz-diff-display');
const targetFreqDisplay = document.getElementById('target-freq-display');
const signalDisplay = document.getElementById('signal-display');

// Contexto del Canvas (Medidor de Aguja)
const canvas = document.getElementById('meter-canvas');
const ctx = canvas.getContext('2d');

// --- EVENTOS DE USUARIO ---
btnStart.addEventListener('click', startTuner);
btnStop.addEventListener('click', stopTuner);

// Botón para mostrar u ocultar el menú de sonidos de referencia
if (btnTestTone) {
    btnTestTone.addEventListener('click', () => {
        const refMenu = document.getElementById('ref-tone-menu');
        if (refMenu.style.display === 'none') {
            refMenu.style.display = 'block';
            btnTestTone.classList.add('active'); 
        } else {
            refMenu.style.display = 'none';
            btnTestTone.classList.remove('active');
            if (isPlayingTone) {
                stopTone();
            }
        }
    });
}

// Botón para mostrar u ocultar el menú de calibración de afinación
if (btnCalibration) {
    btnCalibration.addEventListener('click', () => {
        const tuningMenu = document.getElementById('tuning-menu');
        if (tuningMenu.style.display === 'none') {
            tuningMenu.style.display = 'block';
            btnCalibration.classList.add('active');
        } else {
            tuningMenu.style.display = 'none';
            btnCalibration.classList.remove('active');
        }
    });
}

// Lógica para los botones +/- de afinación
function updateCalibration(newFreq) {
    // Se limita el ajuste a un máximo de 100 de cada lado internamente sin notificarlo visualmente
    if (newFreq >= 340 && newFreq <= 540) {
        A4_FREQUENCY = newFreq;
        calFreqDisplay.innerText = A4_FREQUENCY;
        if (menuCalFreqDisplay) menuCalFreqDisplay.innerText = A4_FREQUENCY;
        // Refrescar el cálculo de la nota seleccionada con la nueva frecuencia
        selectNote(selectedNoteIndex, activeOctave);
    }
}

if (btnTuneDown) {
    btnTuneDown.addEventListener('click', () => {
        updateCalibration(A4_FREQUENCY - 1);
    });
}

if (btnTuneUp) {
    btnTuneUp.addEventListener('click', () => {
        updateCalibration(A4_FREQUENCY + 1);
    });
}

// Botón grande: ESCUCHAR AFINACIÓN DE LA NOTA SELECCIONADA
if (btnListenActiveNote) {
    btnListenActiveNote.addEventListener('click', toggleListenActiveNote);
}

// Selector de octavas (2, 3, 4, 5)
octaveButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const newOctave = parseInt(btn.dataset.octave);
        selectNote(selectedNoteIndex, newOctave);
    });
});

// Teclado para seleccionar cualquiera de las 12 notas
noteKeys.forEach(key => {
    key.addEventListener('click', () => {
        const noteIdx = parseInt(key.dataset.noteIndex);
        selectNote(noteIdx, activeOctave);
    });
});

// Configurar Canvas con escalado nítido para pantallas de alta densidad
const DPR = window.devicePixelRatio || 1;
function setupCanvas() {
    const cssW = 640;
    const cssH = 320;
    canvas.width  = cssW * DPR;
    canvas.height = cssH * DPR;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); 
}
setupCanvas();
window.addEventListener('resize', () => {
    setupCanvas();
    drawMeter(currentCents, hasActiveSignal ? getNeedleColor(currentCents, isCurrentlyTuned) : '#525866', hasActiveSignal, isCurrentlyTuned);
});

// --- GENERADOR Y SELECCIÓN DE NOTA A ESCUCHAR ---
function calculateNoteFrequency(noteIndex, octave) {
    const midiNote = (octave + 1) * 12 + noteIndex;
    return A4_FREQUENCY * Math.pow(2, (midiNote - 69) / 12);
}

function selectNote(noteIndex, octave) {
    selectedNoteIndex = noteIndex;
    activeOctave = octave;

    noteKeys.forEach((key, idx) => {
        key.classList.toggle('active', idx === noteIndex);
    });
    octaveButtons.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.octave) === octave);
    });

    const targetFreq = calculateNoteFrequency(selectedNoteIndex, activeOctave);
    const noteLabel = `${NOTE_STRINGS[selectedNoteIndex]} ${activeOctave}`;

    noteName.innerText = NOTE_STRINGS[selectedNoteIndex];
    noteOctave.innerText = activeOctave;
    targetFreqDisplay.innerText = targetFreq.toFixed(2);

    if (isPlayingTone) {
        listenBtnLabel.innerText = `■ DETENER SONIDO (${noteLabel} • ${targetFreq.toFixed(1)} Hz)`;
        if (toneOscillator && audioContext) {
            toneOscillator.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, 0.025);
        }
    } else {
        listenBtnLabel.innerText = `ESCUCHAR AFINACIÓN (${noteLabel} • ${targetFreq.toFixed(1)} Hz)`;
    }
}

async function toggleListenActiveNote() {
    if (isPlayingTone) {
        stopTone();
        return;
    }

    const targetFreq = calculateNoteFrequency(selectedNoteIndex, activeOctave);
    const noteLabel = `${NOTE_STRINGS[selectedNoteIndex]} ${activeOctave}`;

    isPlayingTone = true;
    if (btnListenActiveNote) {
        btnListenActiveNote.classList.add('playing');
        listenBtnLabel.innerText = `■ DETENER SONIDO (${noteLabel} • ${targetFreq.toFixed(1)} Hz)`;
    }
    btnStop.disabled = false;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContext) {
            audioContext = new AudioCtx();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (!analyser) {
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
        }

        toneOscillator = audioContext.createOscillator();
        toneOscillator.type = 'sine';
        toneOscillator.frequency.setValueAtTime(targetFreq, audioContext.currentTime);

        toneGain = audioContext.createGain();
        toneGain.gain.setValueAtTime(0.001, audioContext.currentTime);
        toneGain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.03);

        toneOscillator.connect(toneGain);
        toneGain.connect(analyser);
        toneGain.connect(audioContext.destination);

        toneOscillator.start();

        tuningStatus.innerText = `REPRODUCIENDO TONO: ${noteLabel}`;
        tuningStatus.style.color = "#00e5ff";

        if (!animationId) {
            framesWithoutSignal = 0;
            updateTuner();
        }
    } catch (err) {
        console.error("Error al escuchar afinación:", err);
    }
}

function stopTone() {
    isPlayingTone = false;
    if (btnListenActiveNote) {
        btnListenActiveNote.classList.remove('playing');
        const targetFreq = calculateNoteFrequency(selectedNoteIndex, activeOctave);
        listenBtnLabel.innerText = `ESCUCHAR AFINACIÓN (${NOTE_STRINGS[selectedNoteIndex]} ${activeOctave} • ${targetFreq.toFixed(1)} Hz)`;
    }

    if (toneOscillator && toneGain && audioContext) {
        try {
            toneGain.gain.setTargetAtTime(0.0001, audioContext.currentTime, 0.02);
            setTimeout(() => {
                if (toneOscillator) {
                    try {
                        toneOscillator.stop();
                        toneOscillator.disconnect();
                    } catch (e) {}
                    toneOscillator = null;
                }
                if (toneGain) {
                    try {
                        toneGain.disconnect();
                    } catch (e) {}
                    toneGain = null;
                }
            }, 35);
        } catch (e) {
            toneOscillator = null;
            toneGain = null;
        }
    } else {
        toneOscillator = null;
        toneGain = null;
    }
}

selectNote(9, 4);

// --- INICIALIZACIÓN DEL SISTEMA DE MICRÓFONO ---
async function startTuner() {
    stopTone();
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                latency: 0
            }
        });

        highPassFilter = audioContext.createBiquadFilter();
        highPassFilter.type = 'highpass';
        highPassFilter.frequency.value = 35;

        lowPassFilter = audioContext.createBiquadFilter();
        lowPassFilter.type = 'lowpass';
        lowPassFilter.frequency.value = 3200;

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        mediaStreamSource.connect(highPassFilter);
        highPassFilter.connect(lowPassFilter);
        lowPassFilter.connect(analyser);

        btnStart.disabled = true;
        btnStop.disabled = false;
        tuningStatus.innerText = "TOCA UNA NOTA...";
        tuningStatus.style.color = "#88909e";

        framesWithoutSignal = 100;
        updateTuner();
    } catch (err) {
        alert("No se pudo acceder al micrófono. Por favor permite los permisos de audio en tu navegador.");
        console.error("Audio error:", err);
    }
}

function stopTuner() {
    stopTone();
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (mediaStreamSource) {
        mediaStreamSource.disconnect();
        mediaStreamSource = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
        analyser = null;
    }

    btnStart.disabled = false;
    btnStop.disabled = true;

    hasActiveSignal = false;
    isCurrentlyTuned = false;
    currentCents = 0;
    targetCents = 0;
    smoothedFreq = 0;

    noteName.innerText = "-";
    noteOctave.innerText = "";
    targetFreqDisplay.innerText = "0.00";
    freqDisplay.innerText = "0.00";
    centsDisplay.innerText = "0.0";
    if (hzDiffDisplay) hzDiffDisplay.innerText = "Δ 0.0 Hz";
    signalDisplay.innerText = "--";
    signalDisplay.style.color = "#fff";

    centsPill.className = "cents-pill neutral";
    centsPill.innerText = "0.0 CENTS";
    tuningStatus.innerText = "DETENIDO";
    tuningStatus.style.color = "#525866";

    noteContainer.className = "note-container";
    tunerDashboard.classList.remove('in-tune');
    guideFlat.className = "guide-item guide-flat";
    guideCenter.className = "guide-item guide-center";
    guideSharp.className = "guide-item guide-sharp";

    drawMeter(0, "#44475a", false, false);
}

// ============================================================================
// ALGORITMO YIN DE DETECCIÓN FUNDAMENTAL DE TONO
// ============================================================================
function detectPitchYIN(buffer, sampleRate) {
    const bufferSize = buffer.length;

    let sumSquares = 0;
    for (let i = 0; i < bufferSize; i++) {
        sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / bufferSize);

    if (rms < 0.012) {
        return { freq: -1, confidence: 0, rms };
    }

    const windowSize = 1024;
    const tauMax = Math.min(1000, bufferSize - windowSize);
    const tauMin = 10; 

    const yinBuffer = new Float32Array(tauMax);
    yinBuffer[0] = 1;

    for (let tau = tauMin; tau < tauMax; tau++) {
        let diff = 0;
        for (let j = 0; j < windowSize; j++) {
            const delta = buffer[j] - buffer[j + tau];
            diff += delta * delta;
        }
        yinBuffer[tau] = diff;
    }

    let runningSum = 0;
    for (let tau = 1; tau < tauMax; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] = runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum;
    }

    const YIN_THRESHOLD = 0.15;
    let tauSelected = -1;

    for (let tau = tauMin; tau < tauMax; tau++) {
        if (yinBuffer[tau] < YIN_THRESHOLD) {
            while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
                tau++;
            }
            tauSelected = tau;
            break;
        }
    }

    if (tauSelected === -1) {
        let minVal = 1;
        let bestTau = -1;
        for (let tau = tauMin; tau < tauMax; tau++) {
            if (yinBuffer[tau] < minVal) {
                minVal = yinBuffer[tau];
                bestTau = tau;
            }
        }
        if (minVal < 0.38 && bestTau > 0) {
            tauSelected = bestTau;
        } else {
            return { freq: -1, confidence: 0, rms };
        }
    }

    let refinedTau = tauSelected;
    if (tauSelected > 0 && tauSelected < tauMax - 1) {
        const s0 = yinBuffer[tauSelected - 1];
        const s1 = yinBuffer[tauSelected];
        const s2 = yinBuffer[tauSelected + 1];
        const denominator = 2 * (2 * s1 - s2 - s0);
        if (denominator !== 0) {
            refinedTau = tauSelected + (s2 - s0) / denominator;
        }
    }

    const frequency = sampleRate / refinedTau;
    const confidence = Math.max(0, 1 - yinBuffer[tauSelected]);

    return { freq: frequency, confidence, rms };
}

// ============================================================================
// BUCLE PRINCIPAL DE ANIMACIÓN Y PROCESAMIENTO
// ============================================================================
function updateTuner() {
    animationId = requestAnimationFrame(updateTuner);

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    const result = detectPitchYIN(buffer, audioContext.sampleRate);
    const rawFreq = result.freq;

    if (rawFreq > 25 && rawFreq < 4200 && result.confidence > 0.6) {
        hasActiveSignal = true;
        framesWithoutSignal = 0;

        if (smoothedFreq === 0 || Math.abs(rawFreq - smoothedFreq) > 30) {
            smoothedFreq = rawFreq;
        } else {
            smoothedFreq += (rawFreq - smoothedFreq) * 0.35;
        }

        const freq = smoothedFreq;

        const noteNum   = 12 * (Math.log(freq / A4_FREQUENCY) / Math.log(2));
        const noteIndex = Math.round(noteNum) + 69;
        const noteString = NOTE_STRINGS[((noteIndex % 12) + 12) % 12];
        const octave     = Math.floor(noteIndex / 12) - 1;
        const targetFreq = A4_FREQUENCY * Math.pow(2, (noteIndex - 69) / 12);

        targetCents = 1200 * Math.log2(freq / targetFreq);
        targetCents = Math.max(-50, Math.min(50, targetCents));

        const deltaHz = freq - targetFreq;
        const absDeltaHz = Math.abs(deltaHz);
        const absCents = Math.abs(targetCents);

        const TOLERANCIA_MAXIMA = 10.0;
        isCurrentlyTuned = (absDeltaHz <= TOLERANCIA_MAXIMA) && (absCents <= TOLERANCIA_MAXIMA);

        noteName.innerText = noteString;
        noteOctave.innerText = octave;
        freqDisplay.innerText = freq.toFixed(2);
        targetFreqDisplay.innerText = targetFreq.toFixed(2);

        const centsSign = targetCents > 0 ? "+" : "";
        centsDisplay.innerText = centsSign + targetCents.toFixed(1);

        const hzSign = deltaHz > 0 ? "+" : "";
        if (hzDiffDisplay) {
            hzDiffDisplay.innerText = `(Δ ${hzSign}${deltaHz.toFixed(1)} Hz)`;
            hzDiffDisplay.style.color = isCurrentlyTuned ? "#00ff88" : (targetCents < 0 ? "#ff9d00" : "#ff4757");
        }

        if (result.confidence > 0.85) {
            signalDisplay.innerText = "EXCELENTE";
            signalDisplay.style.color = "#00ff88";
        } else {
            signalDisplay.innerText = "BUENA";
            signalDisplay.style.color = "#ff9d00";
        }

        if (isCurrentlyTuned) {
            tunerDashboard.classList.add('in-tune');
            noteContainer.className = "note-container in-tune";

            centsPill.className = "cents-pill tuned";
            if (absCents <= 2.0 && absDeltaHz <= 0.8) {
                centsPill.innerText = `${centsSign}${targetCents.toFixed(1)} CENTS • EXACTO (0 Hz)`;
                tuningStatus.innerText = "● AFINADO EXACTO AL CENTRO ●";
            } else {
                centsPill.innerText = `${centsSign}${targetCents.toFixed(1)} CENTS (Δ ${hzSign}${deltaHz.toFixed(1)} Hz) • VÁLIDO`;
                tuningStatus.innerText = "● EN TONO (EN TOLERANCIA ±10 Hz) ●";
            }
            tuningStatus.style.color = "var(--color-tuned)";

            guideCenter.className = "guide-item guide-center active-tuned";
            guideFlat.className = "guide-item guide-flat";
            guideSharp.className = "guide-item guide-sharp";
        } else if (deltaHz < 0) {
            tunerDashboard.classList.remove('in-tune');
            noteContainer.className = "note-container flat";

            centsPill.className = "cents-pill flat";
            centsPill.innerText = `${targetCents.toFixed(1)} CENTS (${deltaHz.toFixed(1)} Hz) • GRAVE`;

            tuningStatus.innerText = `GRAVE ${deltaHz.toFixed(1)} Hz (SUBIR TONO ◀)`;
            tuningStatus.style.color = "var(--color-flat)";

            guideFlat.className = "guide-item guide-flat active-flat";
            guideCenter.className = "guide-item guide-center";
            guideSharp.className = "guide-item guide-sharp";
        } else {
            tunerDashboard.classList.remove('in-tune');
            noteContainer.className = "note-container sharp";

            centsPill.className = "cents-pill sharp";
            centsPill.innerText = `+${targetCents.toFixed(1)} CENTS (+${deltaHz.toFixed(1)} Hz) • AGUDO`;

            tuningStatus.innerText = `AGUDO +${deltaHz.toFixed(1)} Hz (BAJAR TONO ▶)`;
            tuningStatus.style.color = "var(--color-sharp)";

            guideSharp.className = "guide-item guide-sharp active-sharp";
            guideCenter.className = "guide-item guide-center";
            guideFlat.className = "guide-item guide-flat";
        }
    } else {
        framesWithoutSignal++;
        if (framesWithoutSignal > 16) {
            hasActiveSignal = false;
            isCurrentlyTuned = false;
            targetCents += (0 - targetCents) * 0.08;

            tuningStatus.innerText = "ESCUCHANDO...";
            tuningStatus.style.color = "#525866";

            centsPill.className = "cents-pill neutral";
            if (framesWithoutSignal > 60) {
                centsPill.innerText = "-- CENTS";
                centsDisplay.innerText = "--";
                if (hzDiffDisplay) hzDiffDisplay.innerText = "Δ 0.0 Hz";
                signalDisplay.innerText = "SIN SEÑAL";
                signalDisplay.style.color = "#525866";
            }

            guideFlat.className = "guide-item guide-flat";
            guideCenter.className = "guide-item guide-center";
            guideSharp.className = "guide-item guide-sharp";
            tunerDashboard.classList.remove('in-tune');
            noteContainer.className = "note-container";
        }
    }

    const lerpSpeed = hasActiveSignal ? 0.22 : 0.06;
    currentCents += (targetCents - currentCents) * lerpSpeed;

    const needleColor = hasActiveSignal ? getNeedleColor(currentCents, isCurrentlyTuned) : "#44475a";
    drawMeter(currentCents, needleColor, hasActiveSignal, isCurrentlyTuned);
}

function getNeedleColor(cents, isTuned) {
    if (isTuned) return "#00ff88"; 
    if (Math.abs(cents) <= 22) return "#ffaa00"; 
    return "#ff4757"; 
}

function drawMeter(cents, needleColor, isActive, isTuned) {
    const W = 640;
    const H = 320;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H - 30;
    const R  = 240;  

    function centsToAngle(c) {
        const clamped = Math.max(-50, Math.min(50, c));
        return Math.PI - ((clamped + 50) / 100) * Math.PI;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 0, false);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1a1d28';
    ctx.stroke();

    const TOL = 10; 
    const tStart = centsToAngle(TOL);   
    const tEnd   = centsToAngle(-TOL);  

    ctx.beginPath();
    ctx.arc(cx, cy, R, tStart, tEnd, false);
    ctx.lineWidth = 8;
    if (isActive && isTuned) {
        ctx.strokeStyle = '#00ff88';
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur  = 18;
    } else {
        ctx.strokeStyle = 'rgba(0,255,136,0.35)';
        ctx.shadowBlur  = 0;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (let c = -50; c <= 50; c += 5) {
        const ang = centsToAngle(c);
        const isZero   = (c === 0);
        const isTolLim = (Math.abs(c) === 10);
        const isMajor  = (c % 10 === 0);

        let len   = 7;
        let lw    = 1.5;
        let color = '#2c3242';

        if (isZero) {
            len   = 24;
            lw    = 3.5;
            color = (isActive && isTuned) ? '#00ff88' : '#e2e8f0';
        } else if (isTolLim) {
            len   = 18;
            lw    = 2.5;
            color = (isActive && isTuned) ? '#00ff88' : '#00e5ff';
        } else if (isMajor) {
            len   = 13;
            lw    = 2;
            color = '#525a6f';
        }

        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);

        ctx.beginPath();
        ctx.moveTo(cx + (R - len) * cosA, cy - (R - len) * sinA);
        ctx.lineTo(cx + R * cosA,         cy - R * sinA);
        ctx.lineWidth   = lw;
        ctx.strokeStyle = color;
        ctx.lineCap     = 'round';
        ctx.stroke();

        if (isMajor && c !== -40 && c !== 40) {
            const tr = R + 20;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = isZero
                ? "bold 13px 'JetBrains Mono',monospace"
                : (isTolLim ? "700 11px 'JetBrains Mono',monospace" : "600 10px 'JetBrains Mono',monospace");

            if (isZero)       ctx.fillStyle = (isActive && isTuned) ? '#00ff88' : '#ffffff';
            else if (isTolLim) ctx.fillStyle = (isActive && isTuned) ? '#00ff88' : '#00e5ff';
            else               ctx.fillStyle = '#6b7280';

            const label = isZero ? '0' : (c > 0 ? '+' + c : '' + c);
            ctx.fillText(label, cx + tr * cosA, cy - tr * sinA);
        }
    }

    ctx.save();
    ctx.translate(cx, cy - R + 4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-7, -11);
    ctx.lineTo(7, -11);
    ctx.closePath();
    if (isActive && isTuned) {
        ctx.fillStyle   = '#00ff88';
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur  = 14;
    } else {
        ctx.fillStyle = '#333a4d';
    }
    ctx.fill();
    ctx.restore();

    const nAngle  = centsToAngle(cents);
    const nCosA   = Math.cos(nAngle);
    const nSinA   = Math.sin(nAngle);
    const tipLen  = R - 10;
    const tailLen = 28;

    const tipX  = cx + tipLen  * nCosA;
    const tipY  = cy - tipLen  * nSinA;
    const tailX = cx - tailLen * nCosA;
    const tailY = cy + tailLen * nSinA;

    ctx.save();
    if (isActive) {
        ctx.shadowColor = needleColor;
        ctx.shadowBlur  = isTuned ? 20 : 10;
    }
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.lineWidth   = 3.5;
    ctx.strokeStyle = needleColor;
    ctx.lineCap     = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#12141a';
    ctx.fill();
    ctx.lineWidth   = 2.5;
    ctx.strokeStyle = '#2e3445';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? needleColor : '#333a4d';
    ctx.fill();
}

drawMeter(0, '#44475a', false, false);

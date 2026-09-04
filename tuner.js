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

// Elementos de Selección de Nota a Afinar y Escuchar
const btnToggleMode = document.getElementById('btn-toggle-mode');
const modeLabel = document.getElementById('mode-label');
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

// Botón de acceso rápido a La 4
if (btnTestTone) {
    btnTestTone.addEventListener('click', () => {
        selectNote(9, 4);
        toggleListenActiveNote();
    });
}

// Botón grande: ESCUCHAR AFINACIÓN DE LA NOTA SELECCIONADA
if (btnListenActiveNote) {
    btnListenActiveNote.addEventListener('click', toggleListenActiveNote);
}

// btn-toggle-mode ya no existe en esta versión (siempre auto)

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

// Calibración de frecuencia A4 (442 Hz / 440 Hz)
if (btnCalibration) {
    btnCalibration.addEventListener('click', () => {
        // Alternar entre 442 Hz (orquestal) y 440 Hz (estándar internacional)
        A4_FREQUENCY = A4_FREQUENCY === 442 ? 440 : 442;
        calFreqDisplay.innerText = A4_FREQUENCY;
        btnCalibration.classList.toggle('cal-440', A4_FREQUENCY === 440);
        selectNote(selectedNoteIndex, activeOctave);
    });
}

// Configurar Canvas con escalado nítido para pantallas de alta densidad
// IMPORTANTE: resetear el transform antes de cada scale para no acumularlo
const DPR = window.devicePixelRatio || 1;
function setupCanvas() {
    const cssW = 640;
    const cssH = 320;
    canvas.width  = cssW * DPR;
    canvas.height = cssH * DPR;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // resetea Y aplica escala sin acumular
}
setupCanvas();
window.addEventListener('resize', () => {
    setupCanvas();
    drawMeter(currentCents, hasActiveSignal ? getNeedleColor(currentCents, isCurrentlyTuned) : '#525866', hasActiveSignal, isCurrentlyTuned);
});

// --- GENERADOR Y SELECCIÓN DE NOTA A ESCUCHAR ---
function calculateNoteFrequency(noteIndex, octave) {
    // La nota La 4 corresponde al número MIDI 69
    const midiNote = (octave + 1) * 12 + noteIndex;
    return A4_FREQUENCY * Math.pow(2, (midiNote - 69) / 12);
}

function selectNote(noteIndex, octave) {
    selectedNoteIndex = noteIndex;
    activeOctave = octave;

    // Actualizar botones de nota y octava en la interfaz
    noteKeys.forEach((key, idx) => {
        key.classList.toggle('active', idx === noteIndex);
    });
    octaveButtons.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.octave) === octave);
    });

    const targetFreq = calculateNoteFrequency(selectedNoteIndex, activeOctave);
    const noteLabel = `${NOTE_STRINGS[selectedNoteIndex]} ${activeOctave}`;

    // Actualizar pantalla digital y frecuencia objetivo de inmediato
    noteName.innerText = NOTE_STRINGS[selectedNoteIndex];
    noteOctave.innerText = activeOctave;
    targetFreqDisplay.innerText = targetFreq.toFixed(2);

    if (isPlayingTone) {
        listenBtnLabel.innerText = `■ DETENER SONIDO (${noteLabel} • ${targetFreq.toFixed(1)} Hz)`;
        // Transición suave de frecuencia sin clics
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

        // Conectar al analizador para procesarlo en el afinador
        toneOscillator.connect(toneGain);
        toneGain.connect(analyser);
        // Conectar a los altavoces para referencia audible
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

// Inicializar selección por defecto en La 4
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

        // Crear filtros de limpieza acústica (elimina rumble por debajo de 35Hz y ruido por encima de 3000Hz)
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

    // Resetear UI
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
// ALGORITMO YIN DE DETECCIÓN FUNDAMENTAL DE TONO (Pitch Detection)
// Referencia: De Cheveigné & Kawahara (2002)
// ============================================================================
function detectPitchYIN(buffer, sampleRate) {
    const bufferSize = buffer.length;

    // 1. Calcular RMS (Volumen de la señal)
    let sumSquares = 0;
    for (let i = 0; i < bufferSize; i++) {
        sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / bufferSize);

    // Umbral de puerta de ruido (Noise Gate)
    if (rms < 0.012) {
        return { freq: -1, confidence: 0, rms };
    }

    // Tamaño de la ventana de integración y desfase máximo
    const windowSize = 1024;
    // tauMax ~ 1000 cubre frecuencias tan graves como 44.1 Hz (Mi de bajo)
    const tauMax = Math.min(1000, bufferSize - windowSize);
    const tauMin = 10; // ~4000 Hz

    const yinBuffer = new Float32Array(tauMax);
    yinBuffer[0] = 1;

    // 2. Función de Diferencia al Cuadrado d(tau)
    for (let tau = tauMin; tau < tauMax; tau++) {
        let diff = 0;
        for (let j = 0; j < windowSize; j++) {
            const delta = buffer[j] - buffer[j + tau];
            diff += delta * delta;
        }
        yinBuffer[tau] = diff;
    }

    // 3. Diferencia Normalizada de Media Acumulativa (CMNDF)
    let runningSum = 0;
    for (let tau = 1; tau < tauMax; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] = runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum;
    }

    // 4. Búsqueda del primer mínimo absoluto bajo umbral (elimina saltos de octava)
    const YIN_THRESHOLD = 0.15;
    let tauSelected = -1;

    for (let tau = tauMin; tau < tauMax; tau++) {
        if (yinBuffer[tau] < YIN_THRESHOLD) {
            // Descender hasta el mínimo local exacto
            while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
                tau++;
            }
            tauSelected = tau;
            break;
        }
    }

    // Si ningún valor estuvo bajo el umbral estricto, buscar el mínimo global con tolerancia secundaria
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

    // 5. Interpolación Parabólica para resolución sub-muestra
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

        // Suavizado exponencial del tono fundamental
        if (smoothedFreq === 0 || Math.abs(rawFreq - smoothedFreq) > 30) {
            smoothedFreq = rawFreq;
        } else {
            smoothedFreq += (rawFreq - smoothedFreq) * 0.35;
        }

        const freq = smoothedFreq;

        // --------------------------------------------------------------------
        // DETECCIÓN AUTOMÁTICA: Siempre detecta la nota cromática más cercana
        // El menú de notas es SOLO para reproducir tonos de referencia.
        // --------------------------------------------------------------------
        const noteNum   = 12 * (Math.log(freq / A4_FREQUENCY) / Math.log(2));
        const noteIndex = Math.round(noteNum) + 69;
        const noteString = NOTE_STRINGS[((noteIndex % 12) + 12) % 12];
        const octave     = Math.floor(noteIndex / 12) - 1;
        const targetFreq = A4_FREQUENCY * Math.pow(2, (noteIndex - 69) / 12);

        // Desviación en cents en punto flotante
        targetCents = 1200 * Math.log2(freq / targetFreq);
        // Limitar dentro de [-50, +50] para el indicador analógico
        targetCents = Math.max(-50, Math.min(50, targetCents));

        // Diferencia física exacta en Hz respecto al centro objetivo (0 Hz)
        const deltaHz = freq - targetFreq;
        const absDeltaHz = Math.abs(deltaHz);
        const absCents = Math.abs(targetCents);

        // ====================================================================
        // REGLA ESTRICTA DE TOLERANCIA DE 10 HZ:
        // Solo es verde (afinado) si está DENTRO de los 10 Hz (absDeltaHz <= 10.0)
        // Y DENTRO de 10 en la escala del dial (absCents <= 10.0).
        // DESPUÉS DE LOS 10 HZ (o > 10 en dial), NUNCA ES VERDE: ES AGUDO O GRAVE.
        // ====================================================================
        const TOLERANCIA_MAXIMA = 10.0;
        isCurrentlyTuned = (absDeltaHz <= TOLERANCIA_MAXIMA) && (absCents <= TOLERANCIA_MAXIMA);

        // Actualizar valores numéricos en la interfaz
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

        // Calidad de señal
        if (result.confidence > 0.85) {
            signalDisplay.innerText = "EXCELENTE";
            signalDisplay.style.color = "#00ff88";
        } else {
            signalDisplay.innerText = "BUENA";
            signalDisplay.style.color = "#ff9d00";
        }

        // --- LÓGICA DE ESTADOS VISUALES (BEMOL / AFINADO AL CENTRO / SOSTENIDO) ---
        if (isCurrentlyTuned) {
            // == AFINADO VÁLIDO DENTRO DE LA TOLERANCIA DE ±10 HZ ==
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
            // == BEMOL / GRAVE (Subir afinación - Desviación mayor a 10 Hz hacia abajo) ==
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
            // == SOSTENIDO / AGUDO (Bajar afinación - Desviación mayor a 10 Hz hacia arriba) ==
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
        // En ausencia de señal clara
        framesWithoutSignal++;
        if (framesWithoutSignal > 16) {
            hasActiveSignal = false;
            isCurrentlyTuned = false;
            // Desvanecer aguja hacia la posición neutral suavemente
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

    // Suavizado dinámico de la aguja con interpolación no lineal (Lerp)
    const lerpSpeed = hasActiveSignal ? 0.22 : 0.06;
    currentCents += (targetCents - currentCents) * lerpSpeed;

    const needleColor = hasActiveSignal ? getNeedleColor(currentCents, isCurrentlyTuned) : "#44475a";
    drawMeter(currentCents, needleColor, hasActiveSignal, isCurrentlyTuned);
}

function getNeedleColor(cents, isTuned) {
    if (isTuned) return "#00ff88"; // Verde Neón (Dentro de tolerancia ±10 Hz)
    if (Math.abs(cents) <= 22) return "#ffaa00"; // Ámbar / Alerta leve
    return "#ff4757"; // Rojo Coral / Desviación alta
}

// ============================================================================
// RENDERIZADO DEL MEDIDOR ANALÓGICO EN CANVAS — SEMICÍRCULO CLÁSICO
// El medidor va de izquierda (−50 ¢) a derecha (+50 ¢) en 180°.
// El cero (0 ¢) está exactamente en la cúspide (parte superior central).
// ============================================================================
function drawMeter(cents, needleColor, isActive, isTuned) {
    const W = 640;
    const H = 320;
    ctx.clearRect(0, 0, W, H);

    // Pivote de la aguja: parte inferior central
    const cx = W / 2;
    const cy = H - 30;
    const R  = 240;  // radio del arco

    // Mapeado: −50 ¢ → ángulo π (izquierda), +50 ¢ → ángulo 0 (derecha)
    // θ = π − ((cents + 50) / 100) × π
    function centsToAngle(c) {
        const clamped = Math.max(-50, Math.min(50, c));
        return Math.PI - ((clamped + 50) / 100) * Math.PI;
    }

    // ── 1. ARCO DE FONDO (semicírculo completo) ─────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 0, false);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1a1d28';
    ctx.stroke();

    // ── 2. ZONA VERDE DE TOLERANCIA (±10 ¢ alrededor del cero) ─────────────
    const TOL = 10; // cents de cada lado
    const tStart = centsToAngle(TOL);   // ángulo que corresponde a +10 ¢
    const tEnd   = centsToAngle(-TOL);  // ángulo que corresponde a −10 ¢
    // Nota: centsToAngle(+10) < centsToAngle(−10) en la escala de ángulos

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

    // ── 3. GRADUACIONES (cada 5 ¢, marcas grandes cada 10 ¢) ────────────────
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

        // Etiquetas de los valores clave (saltar ±40)
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

    // ── 4. MUESCA CENTRAL (triángulo en la cúspide del arco, en el 0) ────────
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

    // ── 5. AGUJA ANALÓGICA ───────────────────────────────────────────────────
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

    // Punta luminosa
    ctx.beginPath();
    ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // ── 6. PIVOTE CENTRAL ────────────────────────────────────────────────────
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

// Dibujar estado inicial
drawMeter(0, '#44475a', false, false);
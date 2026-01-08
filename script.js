// ==========================
// 🎧 INITIALISATION AUDIO
// ==========================

let audioContext;
let analyser;
let microphone;
let isRecording = false;

const fftSize = 2048;
const captureInterval = 500; // 0.5 seconde

let freqData;
let timeData;
let soundSequence = [];

let startTime = 0;
let captureTimer = null;

// ==========================
// 🎨 ÉLÉMENTS DOM
// ==========================

const recordButton = document.getElementById("record-button");
const recordingStatus = document.getElementById("recording-status");
const statusText = document.querySelector(".status-text");
const frequencyValue = document.getElementById("frequency-value");
const intensityValue = document.getElementById("intensity-value");
const tempoValue = document.getElementById("tempo-value");
const durationValue = document.getElementById("duration-value");
const beatType = document.getElementById("beat-type");
const beatPattern = document.getElementById("beat-pattern");
const timeSignature = document.getElementById("time-signature");
const pulseIndicator = document.getElementById("pulse-indicator");

// ==========================
// 🎛️ BOUTON ENREGISTREMENT
// ==========================

recordButton.addEventListener("click", async () => {
  if (!isRecording) {
    try {
      await startRecording();
      recordButton.textContent = "Arrêter l'enregistrement";
      updateStatus("recording", "Enregistrement en cours...");
    } catch (error) {
      console.error("Erreur d'accès au microphone:", error);
      updateStatus("error", "Erreur: Microphone non accessible");
      alert("Impossible d'accéder au microphone. Veuillez autoriser l'accès.");
    }
  } else {
    stopRecording();
    recordButton.textContent = "Enregistrer un son";
    updateStatus("completed", "Analyse terminée");
  }
});

// ==========================
// 🎙️ START RECORD
// ==========================

async function startRecording() {
  // Vérification de la compatibilité mobile
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.8;

  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);

  // Demande d'accès au microphone avec gestion d'erreur
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false
    } 
  });
  
  microphone = audioContext.createMediaStreamSource(stream);
  microphone.connect(analyser);

  soundSequence = [];
  startTime = audioContext.currentTime;
  isRecording = true;

  // Réinitialiser l'affichage
  resetDisplay();

  captureTimer = setInterval(captureFrame, captureInterval);
  
  // Démarrer la visualisation en temps réel
  visualize();
}

// ==========================
// ⛔ STOP RECORD
// ==========================

function stopRecording() {
  clearInterval(captureTimer);
  isRecording = false;

  // Arrêter le microphone
  if (microphone && microphone.mediaStream) {
    microphone.mediaStream.getTracks().forEach(track => track.stop());
  }

  console.log("🎼 Séquence enregistrée :", soundSequence);

  // Analyser et afficher les résultats
  analyzeSequence();

  // Rejouer automatiquement après enregistrement
  setTimeout(() => {
    playSequence();
  }, 500);
}

// ==========================
// ⏱️ CAPTURE FRAME
// ==========================

function captureFrame() {
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  const soundEvent = analyzeFrame(freqData, timeData);
  soundSequence.push(soundEvent);

  // Mettre à jour l'affichage en temps réel
  updateRealTimeDisplay(soundEvent);
}

// ==========================
// 🧠 ANALYSE AUDIO
// ==========================

function analyzeFrame(freqArray, timeArray) {
  // ---- Fréquence dominante
  let maxVal = 0;
  let maxIndex = 0;

  for (let i = 0; i < freqArray.length; i++) {
    if (freqArray[i] > maxVal) {
      maxVal = freqArray[i];
      maxIndex = i;
    }
  }

  const dominantFreq = (maxIndex * audioContext.sampleRate) / analyser.fftSize;

  // ---- Volume RMS
  let sum = 0;
  for (let i = 0; i < timeArray.length; i++) {
    const v = (timeArray[i] - 128) / 128;
    sum += v * v;
  }

  const rms = Math.sqrt(sum / timeArray.length);

  // ---- Détection attaque
  const threshold = 0.05;
  const isHit = rms > threshold;

  return {
    time: +(audioContext.currentTime - startTime).toFixed(2),
    dominantFreq: Math.round(dominantFreq),
    energy: +rms.toFixed(3),
    isHit: isHit
  };
}

// ==========================
// 📊 ANALYSE DE LA SÉQUENCE
// ==========================

function analyzeSequence() {
  if (!soundSequence.length) return;

  // Calculs globaux
  const duration = soundSequence[soundSequence.length - 1].time;
  const hits = soundSequence.filter(e => e.isHit);
  const avgFreq = hits.reduce((sum, e) => sum + e.dominantFreq, 0) / hits.length || 0;
  const avgEnergy = hits.reduce((sum, e) => sum + e.energy, 0) / hits.length || 0;
  
  // Détection du tempo (BPM)
  const intervals = [];
  for (let i = 1; i < hits.length; i++) {
    intervals.push(hits[i].time - hits[i - 1].time);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length || 1;
  const bpm = Math.round(60 / avgInterval);

  // Déterminer le type de beat
  let beatTypeText = "Ambiant";
  if (bpm > 120) beatTypeText = "Rapide/Électronique";
  else if (bpm > 80) beatTypeText = "Moyen/Pop";
  else if (bpm > 60) beatTypeText = "Lent/Ballad";

  // Signature rythmique
  const signature = hits.length % 4 === 0 ? "4/4" : hits.length % 3 === 0 ? "3/4" : "Libre";

  // Mise à jour de l'affichage
  durationValue.textContent = `${duration.toFixed(1)} s`;
  frequencyValue.textContent = `${Math.round(avgFreq)} Hz`;
  intensityValue.textContent = `${(avgEnergy * 100).toFixed(0)} dB`;
  tempoValue.textContent = `${bpm} BPM`;
  beatType.textContent = beatTypeText;
  timeSignature.textContent = signature;

  // Afficher le pattern
  displayPattern(hits);
}

// ==========================
// 🎨 AFFICHAGE DU PATTERN
// ==========================

function displayPattern(hits) {
  beatPattern.innerHTML = "";
  
  if (hits.length === 0) {
    beatPattern.innerHTML = '<span class="pattern-placeholder">Aucun hit détecté</span>';
    return;
  }

  const patternContainer = document.createElement("div");
  patternContainer.style.display = "flex";
  patternContainer.style.gap = "5px";
  patternContainer.style.flexWrap = "wrap";

  hits.slice(0, 16).forEach((hit, index) => {
    const dot = document.createElement("div");
    dot.style.width = "12px";
    dot.style.height = "12px";
    dot.style.borderRadius = "50%";
    dot.style.background = `radial-gradient(circle, #f4d03f, #d4af37)`;
    dot.style.boxShadow = "0 0 8px rgba(212, 175, 55, 0.6)";
    dot.style.opacity = Math.min(hit.energy * 2, 1);
    patternContainer.appendChild(dot);
  });

  beatPattern.appendChild(patternContainer);
}

// ==========================
// 🎬 VISUALISATION TEMPS RÉEL
// ==========================

function visualize() {
  if (!isRecording) return;

  analyser.getByteFrequencyData(freqData);
  
  // Calculer l'énergie moyenne pour l'animation
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) {
    sum += freqData[i];
  }
  const avgEnergy = sum / freqData.length / 255;

  // Animer le cercle pulsant
  const scale = 1 + avgEnergy * 0.3;
  pulseIndicator.style.transform = `scale(${scale})`;

  requestAnimationFrame(visualize);
}

// ==========================
// 🔄 MISE À JOUR TEMPS RÉEL
// ==========================

function updateRealTimeDisplay(event) {
  frequencyValue.textContent = `${event.dominantFreq} Hz`;
  intensityValue.textContent = `${(event.energy * 100).toFixed(0)} dB`;
  durationValue.textContent = `${event.time.toFixed(1)} s`;
}

// ==========================
// 🎯 MISE À JOUR DU STATUT
// ==========================

function updateStatus(status, text) {
  recordingStatus.setAttribute("data-status", status);
  statusText.textContent = text;
}

// ==========================
// 🔄 RÉINITIALISER L'AFFICHAGE
// ==========================

function resetDisplay() {
  frequencyValue.textContent = "-- Hz";
  intensityValue.textContent = "-- dB";
  tempoValue.textContent = "-- BPM";
  durationValue.textContent = "-- s";
  beatType.textContent = "En attente d'analyse";
  timeSignature.textContent = "--/--";
  beatPattern.innerHTML = '<span class="pattern-placeholder">Aucun pattern généré</span>';
}

// ==========================
// ▶️ REJOUER LA SÉQUENCE
// ==========================

function playSequence() {
  if (!soundSequence.length) return;

  updateStatus("playing", "Lecture en cours...");

  const now = audioContext.currentTime;

  soundSequence.forEach((event, index) => {
    if (!event.isHit) return;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.value = event.dominantFreq || 220;

    gain.gain.value = Math.min(event.energy * 1.5, 0.5);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    const start = now + index * (captureInterval / 1000);
    osc.start(start);
    osc.stop(start + 0.4);
  });

  // Réinitialiser le statut après la lecture
  const playbackDuration = soundSequence.length * captureInterval;
  setTimeout(() => {
    updateStatus("inactive", "Prêt à enregistrer");
  }, playbackDuration);
}

// ==========================
// 📱 GESTION MOBILE
// ==========================

// Empêcher le zoom sur double-tap (mobile)
let lastTouchEnd = 0;
document.addEventListener('touchend', (event) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    event.preventDefault();
  }
  lastTouchEnd = now;
}, false);

// Optimisation des performances sur mobile
if ('ontouchstart' in window) {
  document.body.style.touchAction = 'manipulation';
}

// ==========================
// 🎬 INITIALISATION
// ==========================

console.log("🎵 SoundRhythm initialisé");
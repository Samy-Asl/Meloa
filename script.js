// ================================================
// 🎵 SOUNDRHYTHM DAW - PROFESSIONAL VERSION
// ================================================

// ===== CORE AUDIO =====
let audioContext;
let analyser;
let microphone;
let masterGainNode;

// ===== PROJECT STATE =====
let project = {
    name: 'Mon Projet Beat',
    tracks: [],
    tempo: 120,
    volume: 0.8
};

let currentTrackId = 0;
let isRecording = false;
let recordingStartTime = 0;
let recordingData = [];
let currentInstrument = 'synth';

// ===== PLAYBACK STATE =====
let isPlaying = false;
let loopEnabled = true;
let playbackStartTime = 0;
let playheadPosition = 0;
let animationFrameId = null;
let zoomLevel = 1;

// ===== DOM ELEMENTS =====
const recordBtn = document.getElementById('record-btn');
const recTimer = document.getElementById('rec-timer');
const instrumentSelect = document.getElementById('instrument-select');
const masterTempo = document.getElementById('master-tempo');
const masterTempoDisplay = document.getElementById('master-tempo-display');
const masterVolume = document.getElementById('master-volume');
const masterVolumeDisplay = document.getElementById('master-volume-display');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const loopBtn = document.getElementById('loop-btn');
const tracksContainer = document.getElementById('tracks-container');
const currentTimeDisplay = document.getElementById('current-time');
const totalTimeDisplay = document.getElementById('total-time');
const trackCountDisplay = document.getElementById('track-count');
const totalDurationDisplay = document.getElementById('total-duration');
const projectNameInput = document.getElementById('project-name');
const saveProjectBtn = document.getElementById('save-project-btn');
const newProjectBtn = document.getElementById('new-project-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomLevelDisplay = document.getElementById('zoom-level');
const playheadCanvas = document.getElementById('playhead-canvas');
const timelineRuler = document.getElementById('timeline-ruler');

// Track Editor Modal
const trackEditorModal = document.getElementById('track-editor-modal');
const closeEditorBtn = document.getElementById('close-editor');
const editorTrackName = document.getElementById('editor-track-name');
const pitchSlider = document.getElementById('pitch-slider');
const pitchValue = document.getElementById('pitch-value');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const trackVolumeSlider = document.getElementById('track-volume-slider');
const trackVolumeValue = document.getElementById('track-volume-value');
const reverseCheckbox = document.getElementById('reverse-checkbox');
const panSlider = document.getElementById('pan-slider');
const panValue = document.getElementById('pan-value');
const applyChangesBtn = document.getElementById('apply-changes-btn');
const resetChangesBtn = document.getElementById('reset-changes-btn');

let currentEditingTrack = null;

// ================================================
// 🎤 RECORDING SYSTEM
// ================================================

recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
});

async function startRecording() {
    try {
        // Initialize Audio Context
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            masterGainNode = audioContext.createGain();
            masterGainNode.gain.value = project.volume;
            masterGainNode.connect(audioContext.destination);
        }

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;

        // Get Microphone
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        // Start Recording
        isRecording = true;
        recordingStartTime = audioContext.currentTime;
        recordingData = [];
        currentInstrument = instrumentSelect.value;

        recordBtn.classList.add('recording');
        recordBtn.querySelector('.text').textContent = 'STOP';

        analyzeRecording();
        updateRecTimer();

    } catch (error) {
        console.error('Erreur microphone:', error);
        alert('Impossible d\'accéder au microphone. Vérifiez les permissions.');
    }
}

function stopRecording() {
    isRecording = false;

    // Stop Microphone
    if (microphone && microphone.mediaStream) {
        microphone.mediaStream.getTracks().forEach(track => track.stop());
    }

    recordBtn.classList.remove('recording');
    recordBtn.querySelector('.text').textContent = 'REC';

    // Process and create track
    if (recordingData.length > 0) {
        createTrackFromRecording();
    } else {
        alert('Aucun son détecté. Réessayez en faisant plus de bruit !');
    }
}

function analyzeRecording() {
    if (!isRecording) return;

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
        const normalized = (timeData[i] - 128) / 128;
        sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / timeData.length);

    // Detect onset
    if (rms > 0.12) {
        const currentTime = audioContext.currentTime - recordingStartTime;

        // Find dominant frequency
        let maxAmp = 0;
        let maxIndex = 0;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxAmp) {
                maxAmp = freqData[i];
                maxIndex = i;
            }
        }

        const frequency = (maxIndex * audioContext.sampleRate) / analyser.fftSize;

        recordingData.push({
            time: currentTime,
            frequency: frequency,
            energy: rms,
            velocity: Math.min(rms * 2, 1)
        });
    }

    requestAnimationFrame(analyzeRecording);
}

function updateRecTimer() {
    if (!isRecording) return;
    const elapsed = audioContext.currentTime - recordingStartTime;
    recTimer.textContent = formatTime(elapsed);
    requestAnimationFrame(updateRecTimer);
}

// ================================================
// 🎼 TRACK CREATION
// ================================================

function createTrackFromRecording() {
    const quantizedBeats = quantizeBeats(recordingData);
    
    if (quantizedBeats.length === 0) {
        alert('Aucun beat détecté !');
        return;
    }

    const duration = quantizedBeats[quantizedBeats.length - 1].time;

    const track = {
        id: ++currentTrackId,
        name: `Track ${currentTrackId}`,
        instrument: currentInstrument,
        beats: quantizedBeats,
        duration: duration,
        tempo: project.tempo,
        
        // Editable parameters
        pitch: 0,
        speed: 100,
        volume: 100,
        pan: 0,
        reversed: false,
        
        // Playback state
        muted: false,
        soloed: false
    };

    project.tracks.push(track);
    renderTrack(track);
    updateProjectInfo();

    console.log('✅ Track créée:', track);
}

function quantizeBeats(beats) {
    if (beats.length < 2) return beats;

    let totalInterval = 0;
    for (let i = 1; i < beats.length; i++) {
        totalInterval += beats[i].time - beats[i - 1].time;
    }
    const avgInterval = totalInterval / (beats.length - 1);
    const gridSize = avgInterval / 2;

    return beats.map(beat => ({
        ...beat,
        time: Math.round(beat.time / gridSize) * gridSize
    }));
}

// ================================================
// 🎨 TRACK RENDERING
// ================================================

function renderTrack(track) {
    // Remove empty state
    const emptyState = tracksContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    trackEl.dataset.trackId = track.id;

    trackEl.innerHTML = `
        <div class="track-header">
            <div class="track-info">
                <div class="track-number">${track.id}</div>
                <div class="track-details">
                    <h4>${track.name}</h4>
                    <div class="track-meta">
                        ${getInstrumentIcon(track.instrument)} ${track.instrument} • ${track.beats.length} notes • ${track.duration.toFixed(1)}s
                    </div>
                </div>
            </div>
            <div class="track-controls">
                <button class="track-btn solo" data-action="solo">S</button>
                <button class="track-btn mute" data-action="mute">M</button>
                <button class="track-btn edit" data-action="edit">✏️</button>
                <button class="track-btn delete" data-action="delete">🗑️</button>
            </div>
        </div>
        <div class="track-content">
            <div class="track-waveform">
                <canvas class="waveform-canvas" width="800" height="80"></canvas>
            </div>
            <div class="track-timeline">
                <div class="track-progress">
                    <div class="track-progress-bar"></div>
                </div>
                <div class="track-time">
                    <span class="current">0:00</span> / <span class="total">${formatTime(track.duration)}</span>
                </div>
            </div>
        </div>
    `;

    tracksContainer.appendChild(trackEl);

    // Draw waveform
    drawWaveform(track, trackEl.querySelector('.waveform-canvas'));

    // Event listeners
    trackEl.querySelectorAll('.track-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            handleTrackAction(track.id, action, e.target);
        });
    });
}

function drawWaveform(track, canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, width, height);

    // Draw beats as waveform
    const totalWidth = track.duration * zoomLevel * 100;
    const barWidth = Math.max(2, width / track.beats.length);

    ctx.fillStyle = '#d4af37';
    track.beats.forEach((beat, index) => {
        const x = (beat.time / track.duration) * width;
        const barHeight = beat.velocity * height * 0.8;
        const y = (height - barHeight) / 2;
        
        ctx.fillRect(x, y, barWidth, barHeight);
    });
}

function getInstrumentIcon(instrument) {
    const icons = {
        synth: '🎹',
        piano: '🎹',
        guitar: '🎸',
        bass: '🎸',
        drums: '🥁',
        pad: '🌊'
    };
    return icons[instrument] || '🎵';
}

// ================================================
// 🎛️ TRACK ACTIONS
// ================================================

function handleTrackAction(trackId, action, button) {
    const track = project.tracks.find(t => t.id === trackId);
    if (!track) return;

    switch(action) {
        case 'solo':
            track.soloed = !track.soloed;
            button.classList.toggle('active');
            // If any track is soloed, mute others
            if (project.tracks.some(t => t.soloed)) {
                project.tracks.forEach(t => {
                    if (!t.soloed) t.muted = true;
                });
            } else {
                project.tracks.forEach(t => t.muted = false);
            }
            break;

        case 'mute':
            track.muted = !track.muted;
            button.classList.toggle('active');
            break;

        case 'edit':
            openTrackEditor(track);
            break;

        case 'delete':
            if (confirm(`Supprimer ${track.name} ?`)) {
                deleteTrack(trackId);
            }
            break;
    }
}

function deleteTrack(trackId) {
    project.tracks = project.tracks.filter(t => t.id !== trackId);
    const trackEl = document.querySelector(`[data-track-id="${trackId}"]`);
    if (trackEl) trackEl.remove();
    
    updateProjectInfo();

    if (project.tracks.length === 0) {
        showEmptyState();
    }
}

function showEmptyState() {
    tracksContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🎵</div>
            <h2>Aucune track</h2>
            <p>Cliquez sur REC pour enregistrer votre première track</p>
        </div>
    `;
}

// ================================================
// ✏️ TRACK EDITOR
// ================================================

function openTrackEditor(track) {
    currentEditingTrack = track;
    editorTrackName.textContent = track.name;

    // Set current values
    pitchSlider.value = track.pitch;
    pitchValue.textContent = track.pitch;
    
    speedSlider.value = track.speed;
    speedValue.textContent = track.speed;
    
    trackVolumeSlider.value = track.volume;
    trackVolumeValue.textContent = track.volume;
    
    panSlider.value = track.pan;
    panValue.textContent = track.pan;
    
    reverseCheckbox.checked = track.reversed;

    trackEditorModal.classList.add('open');
}

closeEditorBtn.addEventListener('click', () => {
    trackEditorModal.classList.remove('open');
    currentEditingTrack = null;
});

// Sliders update
pitchSlider.addEventListener('input', (e) => {
    pitchValue.textContent = e.target.value;
});

speedSlider.addEventListener('input', (e) => {
    speedValue.textContent = e.target.value;
});

trackVolumeSlider.addEventListener('input', (e) => {
    trackVolumeValue.textContent = e.target.value;
});

panSlider.addEventListener('input', (e) => {
    panValue.textContent = e.target.value;
});

applyChangesBtn.addEventListener('click', () => {
    if (!currentEditingTrack) return;

    currentEditingTrack.pitch = parseInt(pitchSlider.value);
    currentEditingTrack.speed = parseInt(speedSlider.value);
    currentEditingTrack.volume = parseInt(trackVolumeSlider.value);
    currentEditingTrack.pan = parseInt(panSlider.value);
    currentEditingTrack.reversed = reverseCheckbox.checked;

    trackEditorModal.classList.remove('open');
    console.log('✅ Track modifiée:', currentEditingTrack);
});

resetChangesBtn.addEventListener('click', () => {
    if (!currentEditingTrack) return;

    currentEditingTrack.pitch = 0;
    currentEditingTrack.speed = 100;
    currentEditingTrack.volume = 100;
    currentEditingTrack.pan = 0;
    currentEditingTrack.reversed = false;

    openTrackEditor(currentEditingTrack);
});

// ================================================
// ▶️ PLAYBACK SYSTEM
// ================================================

playBtn.addEventListener('click', () => {
    if (!isPlaying && project.tracks.length > 0) {
        startPlayback();
    }
});

stopBtn.addEventListener('click', () => {
    stopPlayback();
});

loopBtn.addEventListener('click', () => {
    loopEnabled = !loopEnabled;
    loopBtn.classList.toggle('active');
});

function startPlayback() {
    if (project.tracks.length === 0) return;

    isPlaying = true;
    playbackStartTime = audioContext.currentTime;
    playheadPosition = 0;

    playBtn.classList.add('active');
    
    playAllTracks();
    updatePlayhead();
}

function stopPlayback() {
    isPlaying = false;
    playheadPosition = 0;

    playBtn.classList.remove('active');
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    // Reset progress bars
    document.querySelectorAll('.track-progress-bar').forEach(bar => {
        bar.style.width = '0%';
    });

    currentTimeDisplay.textContent = '0:00';
}

function playAllTracks() {
    if (!isPlaying) return;

    const now = audioContext.currentTime;
    const beatInterval = 60 / project.tempo;

    project.tracks.forEach(track => {
        if (track.muted) return;

        const beatsToPlay = track.reversed ? [...track.beats].reverse() : track.beats;
        const speedMultiplier = track.speed / 100;
        const pitchOffset = track.pitch;

        beatsToPlay.forEach((beat, index) => {
            const playTime = now + (index * beatInterval) / speedMultiplier;
            const adjustedFreq = beat.frequency * Math.pow(2, pitchOffset / 12);
            const adjustedVelocity = beat.velocity * (track.volume / 100);

            playNote(
                { ...beat, frequency: adjustedFreq, velocity: adjustedVelocity },
                track.instrument,
                playTime,
                track.pan
            );
        });
    });

    // Loop if enabled
    const longestTrack = Math.max(...project.tracks.map(t => t.beats.length));
    const loopDuration = (longestTrack * beatInterval) * 1000;

    if (loopEnabled) {
        setTimeout(playAllTracks, loopDuration);
    } else {
        setTimeout(stopPlayback, loopDuration);
    }
}

function updatePlayhead() {
    if (!isPlaying) return;

    const elapsed = audioContext.currentTime - playbackStartTime;
    const maxDuration = Math.max(...project.tracks.map(t => t.duration), 1);
    
    playheadPosition = (elapsed / maxDuration) * 100;
    currentTimeDisplay.textContent = formatTime(elapsed);

    // Update track progress bars
    project.tracks.forEach(track => {
        const trackEl = document.querySelector(`[data-track-id="${track.id}"]`);
        if (trackEl) {
            const progressBar = trackEl.querySelector('.track-progress-bar');
            const progress = Math.min((elapsed / track.duration) * 100, 100);
            progressBar.style.width = `${progress}%`;
        }
    });

    // Draw playhead
    drawPlayhead();

    animationFrameId = requestAnimationFrame(updatePlayhead);
}

function drawPlayhead() {
    const canvas = playheadCanvas;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const ctx = canvas.getContext('2d');
    const x = (playheadPosition / 100) * canvas.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
}

// ================================================
// 🎹 INSTRUMENT ENGINES
// ================================================

function playNote(beat, instrument, time, pan = 0) {
    const freq = beat.frequency || 440;
    const vel = beat.velocity || 0.5;
    const dur = 0.3;

    // Create panner
    const panner = audioContext.createStereoPanner();
    panner.pan.value = pan / 100;

    switch(instrument) {
        case 'synth':
            playSynth(freq, vel, time, dur, panner);
            break;
        case 'piano':
            playPiano(freq, vel, time, dur, panner);
            break;
        case 'guitar':
            playGuitar(freq, vel, time, dur, panner);
            break;
        case 'bass':
            playBass(freq, vel, time, dur, panner);
            break;
        case 'drums':
            playDrum(freq, vel, time, panner);
            break;
        case 'pad':
            playPad(freq, vel, time, dur * 2, panner);
            break;
    }
}

function playSynth(freq, vel, time, dur, panner) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.3, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainNode);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playPiano(freq, vel, time, dur, panner) {
    for (let i = 1; i <= 3; i++) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = freq * i;
        
        const amp = vel * 0.2 / i;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(amp, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, time + dur * 1.5);
        
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(masterGainNode);
        
        osc.start(time);
        osc.stop(time + dur * 1.5);
    }
}

function playGuitar(freq, vel, time, dur, panner) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.type = 'square';
    osc.frequency.value = freq;
    
    gain.gain.setValueAtTime(vel * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainNode);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playBass(freq, vel, time, dur, panner) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq * 0.5;
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.5, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainNode);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playDrum(freq, vel, time, panner) {
    // Simplified drum synthesis
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.frequency.setValueAtTime(freq < 150 ? 150 : 200, time);
    osc.frequency.exponentialRampToValueAtTime(freq < 150 ? 30 : 100, time + 0.1);
    
    gain.gain.setValueAtTime(vel * 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainNode);
    
    osc.start(time);
    osc.stop(time + 0.2);
}

function playPad(freq, vel, time, dur, panner) {
    const detunes = [-7, 0, 7, 12];
    
    detunes.forEach(detune => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune * 100;
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(vel * 0.1, time + 0.3);
        gain.gain.linearRampToValueAtTime(0.01, time + dur);
        
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(masterGainNode);
        
        osc.start(time);
        osc.stop(time + dur);
    });
}

// ================================================
// 🎛️ MASTER CONTROLS
// ================================================

masterTempo.addEventListener('input', (e) => {
    project.tempo = parseInt(e.target.value);
    masterTempoDisplay.textContent = project.tempo;
});

masterVolume.addEventListener('input', (e) => {
    project.volume = parseInt(e.target.value) / 100;
    masterVolumeDisplay.textContent = parseInt(e.target.value);
    if (masterGainNode) {
        masterGainNode.gain.value = project.volume;
    }
});

// ================================================
// 💾 PROJECT MANAGEMENT
// ================================================

projectNameInput.addEventListener('change', (e) => {
    project.name = e.target.value;
});

saveProjectBtn.addEventListener('click', () => {
    const projectData = JSON.stringify(project, null, 2);
    const blob = new Blob([projectData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.json`;
    a.click();
    
    alert('✅ Projet sauvegardé !');
});

newProjectBtn.addEventListener('click', () => {
    if (confirm('Créer un nouveau projet ? (Les modifications non sauvegardées seront perdues)')) {
        project = {
            name: 'Mon Projet Beat',
            tracks: [],
            tempo: 120,
            volume: 0.8
        };
        currentTrackId = 0;
        projectNameInput.value = project.name;
        showEmptyState();
        updateProjectInfo();
    }
});

// ================================================
// 🔍 ZOOM
// ================================================

zoomInBtn.addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel * 1.2, 5);
    zoomLevelDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
    redrawAllWaveforms();
});

zoomOutBtn.addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel / 1.2, 0.5);
    zoomLevelDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
    redrawAllWaveforms();
});

function redrawAllWaveforms() {
    project.tracks.forEach(track => {
        const trackEl = document.querySelector(`[data-track-id="${track.id}"]`);
        if (trackEl) {
            const canvas = trackEl.querySelector('.waveform-canvas');
            drawWaveform(track, canvas);
        }
    });
}

// ================================================
// 📊 UI UPDATES
// ================================================

function updateProjectInfo() {
    trackCountDisplay.textContent = project.tracks.length;
    
    const maxDuration = project.tracks.length > 0 
        ? Math.max(...project.tracks.map(t => t.duration))
        : 0;
    
    totalDurationDisplay.textContent = formatTime(maxDuration);
    totalTimeDisplay.textContent = formatTime(maxDuration);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}


// =========================
// 📱 SIDEBAR MOBILE FULLSCREEN
// =========================
const mobileMenuBtn = document.getElementById("mobile-menu-btn");
const sidebar = document.getElementById("sidebar");
const closeBtn = document.getElementById("sidebar-close-btn");

function openSidebar() {
  sidebar.classList.add("open");
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  document.body.classList.remove("sidebar-open");
}

mobileMenuBtn?.addEventListener("click", openSidebar);
closeBtn?.addEventListener("click", closeSidebar);

// Option bonus : fermer en cliquant hors contenu
sidebar.addEventListener("click", (e) => {
  if (e.target === sidebar) {
    closeSidebar();
  }
});


// ================================================
// 🎬 INITIALIZATION
// ================================================

console.log('🎵 SoundRhythm DAW initialized');
updateProjectInfo();

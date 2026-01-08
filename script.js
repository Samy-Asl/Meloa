// =============================================
// 🎵 SOUNDRHYTHM STUDIO - COMPLETE REWRITE
// =============================================

// Audio Context
let audioContext;
let analyser;
let microphone;
let masterGain;

// Recording State
let isRecording = false;
let recordingStartTime = 0;
let recordingData = [];

// Samples Bank
let samples = [];
let currentInstrument = 'synth';

// Playback State
let isPlaying = false;
let loopEnabled = true;
let currentTempo = 120;
let mainVolume = 0.8;

// Analysis
const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const ONSET_THRESHOLD = 0.15; // Plus sensible pour détecter plus de beats

// DOM Elements
const recordButton = document.getElementById('record-button');
const recordingStatus = document.getElementById('recording-status');
const statusText = document.querySelector('.status-text');
const recordingTimer = document.getElementById('recording-timer');
const waveformCanvas = document.getElementById('waveform-canvas');
const beatGrid = document.getElementById('beat-grid');
const samplePads = document.getElementById('sample-pads');
const playButton = document.getElementById('play-button');
const stopButton = document.getElementById('stop-button');
const loopButton = document.getElementById('loop-button');
const tempoSlider = document.getElementById('tempo-slider');
const tempoDisplay = document.getElementById('tempo-display');
const volumeSlider = document.getElementById('volume-slider');
const volumeDisplay = document.getElementById('volume-display');
const clearSamplesBtn = document.getElementById('clear-samples-btn');
const instrumentBtns = document.querySelectorAll('.instrument-btn');

// Analysis Display
const notesCount = document.getElementById('notes-count');
const patternDuration = document.getElementById('pattern-duration');
const patternType = document.getElementById('pattern-type');
const patternComplexity = document.getElementById('pattern-complexity');
const tempoValue = document.getElementById('tempo-value');

// =============================================
// 🎤 RECORDING SYSTEM
// =============================================

recordButton.addEventListener('click', async () => {
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
});

async function startRecording() {
    try {
        // Initialize Audio Context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.3; // Plus réactif
        
        masterGain = audioContext.createGain();
        masterGain.gain.value = mainVolume;
        masterGain.connect(audioContext.destination);

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
        
        updateStatus('recording', 'Enregistrement...');
        recordButton.classList.add('recording');
        recordButton.querySelector('.button-text').textContent = 'Arrêter';
        
        // Start Analysis Loop
        analyzeAudio();
        updateTimer();
        visualizeWaveform();
        
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
    
    // Process Recording
    processRecording();
    
    // Update UI
    updateStatus('inactive', 'Prêt');
    recordButton.classList.remove('recording');
    recordButton.querySelector('.button-text').textContent = 'Enregistrer';
}

// =============================================
// 🧠 ADVANCED AUDIO ANALYSIS
// =============================================

function analyzeAudio() {
    if (!isRecording) return;
    
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);
    
    // Calculate RMS Energy
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
        const normalized = (timeData[i] - 128) / 128;
        sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / timeData.length);
    
    // Detect Beat (Onset Detection)
    if (rms > ONSET_THRESHOLD) {
        const currentTime = audioContext.currentTime - recordingStartTime;
        
        // Find Dominant Frequency
        let maxAmp = 0;
        let maxIndex = 0;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxAmp) {
                maxAmp = freqData[i];
                maxIndex = i;
            }
        }
        
        const frequency = (maxIndex * audioContext.sampleRate) / analyser.fftSize;
        
        // Store Beat
        recordingData.push({
            time: currentTime,
            frequency: frequency,
            energy: rms,
            velocity: Math.min(rms * 2, 1)
        });
        
        // Visual Feedback
        addBeatMarker(recordingData.length);
    }
    
    requestAnimationFrame(analyzeAudio);
}

function addBeatMarker(number) {
    const marker = document.createElement('div');
    marker.className = 'beat-marker';
    marker.textContent = number;
    beatGrid.appendChild(marker);
}

// =============================================
// 📊 RECORDING PROCESSING
// =============================================

function processRecording() {
    if (recordingData.length === 0) {
        alert('Aucun son détecté. Essayez de faire un son plus fort !');
        return;
    }
    
    console.log('🎵 Beats détectés:', recordingData);
    
    // Quantize Beats (snap to grid)
    const quantizedBeats = quantizeBeats(recordingData);
    
    // Analyze Pattern
    const analysis = analyzePattern(quantizedBeats);
    
    // Create Sample
    const sample = {
        id: Date.now(),
        instrument: currentInstrument,
        beats: quantizedBeats,
        tempo: analysis.tempo,
        duration: analysis.duration,
        complexity: analysis.complexity,
        type: analysis.type
    };
    
    samples.push(sample);
    addSamplePad(sample);
    updateAnalysisDisplay(analysis);
    
    // Enable playback
    playButton.disabled = false;
    stopButton.disabled = false;
    
    console.log('✅ Sample créé:', sample);
}

function quantizeBeats(beats) {
    if (beats.length < 2) return beats;
    
    // Calculate average interval
    let totalInterval = 0;
    for (let i = 1; i < beats.length; i++) {
        totalInterval += beats[i].time - beats[i - 1].time;
    }
    const avgInterval = totalInterval / (beats.length - 1);
    
    // Determine grid size (eighth, quarter, etc)
    const gridSize = avgInterval / 2; // Subdivision
    
    // Snap each beat to nearest grid point
    return beats.map((beat, index) => {
        const gridPosition = Math.round(beat.time / gridSize) * gridSize;
        return {
            ...beat,
            time: gridPosition,
            gridIndex: Math.round(gridPosition / gridSize)
        };
    });
}

function analyzePattern(beats) {
    const duration = beats[beats.length - 1].time;
    const count = beats.length;
    
    // Calculate Tempo (BPM)
    let intervals = [];
    for (let i = 1; i < beats.length; i++) {
        intervals.push(beats[i].time - beats[i - 1].time);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length || 0.5;
    const tempo = Math.round(60 / avgInterval);
    
    // Determine Type
    let type = 'Simple';
    if (count > 12) type = 'Complexe';
    else if (count > 6) type = 'Moyen';
    
    // Determine Complexity
    const variability = calculateVariability(intervals);
    let complexity = 'Faible';
    if (variability > 0.3) complexity = 'Élevée';
    else if (variability > 0.15) complexity = 'Moyenne';
    
    return {
        duration: duration.toFixed(1),
        count: count,
        tempo: Math.min(Math.max(tempo, 60), 200),
        type: type,
        complexity: complexity
    };
}

function calculateVariability(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance) / mean;
}

// =============================================
// 🎹 INSTRUMENT ENGINES
// =============================================

function playNote(beat, instrument, time) {
    const frequency = beat.frequency || 440;
    const velocity = beat.velocity || 0.5;
    const duration = 0.3;
    
    switch(instrument) {
        case 'synth':
            playSynth(frequency, velocity, time, duration);
            break;
        case 'piano':
            playPiano(frequency, velocity, time, duration);
            break;
        case 'guitar':
            playGuitar(frequency, velocity, time, duration);
            break;
        case 'bass':
            playBass(frequency, velocity, time, duration);
            break;
        case 'drums':
            playDrum(frequency, velocity, time);
            break;
        case 'pad':
            playPad(frequency, velocity, time, duration * 2);
            break;
    }
}

function playSynth(freq, vel, time, dur) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    filter.Q.value = 5;
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.3, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playPiano(freq, vel, time, dur) {
    // Simulate piano with multiple harmonics
    for (let i = 1; i <= 3; i++) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = freq * i;
        
        const amplitude = vel * 0.2 / i;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(amplitude, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, time + dur * 1.5);
        
        osc.connect(gain);
        gain.connect(masterGain);
        
        osc.start(time);
        osc.stop(time + dur * 1.5);
    }
}

function playGuitar(freq, vel, time, dur) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    
    osc.type = 'square';
    osc.frequency.value = freq;
    
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    
    // Pluck envelope
    gain.gain.setValueAtTime(vel * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playBass(freq, vel, time, dur) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq * 0.5; // Octave lower
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 2, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.5, time + dur);
    filter.Q.value = 3;
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.5, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    
    osc.start(time);
    osc.stop(time + dur);
}

function playDrum(freq, vel, time) {
    if (freq < 150) {
        // Kick
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
        
        gain.gain.setValueAtTime(vel * 0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
        
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(time);
        osc.stop(time + 0.3);
        
    } else if (freq < 400) {
        // Snare
        const osc = audioContext.createOscillator();
        const noise = createNoiseBuffer(0.15);
        const gain1 = audioContext.createGain();
        const gain2 = audioContext.createGain();
        
        osc.frequency.value = 200;
        gain1.gain.setValueAtTime(vel * 0.3, time);
        gain1.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        
        noise.connect(gain2);
        osc.connect(gain1);
        gain1.connect(masterGain);
        gain2.connect(masterGain);
        
        gain2.gain.setValueAtTime(vel * 0.2, time);
        gain2.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
        
        osc.start(time);
        noise.start(time);
        osc.stop(time + 0.2);
        
    } else {
        // HiHat
        const noise = createNoiseBuffer(0.08);
        const filter = audioContext.createBiquadFilter();
        const gain = audioContext.createGain();
        
        filter.type = 'highpass';
        filter.frequency.value = 7000;
        
        gain.gain.setValueAtTime(vel * 0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        noise.start(time);
    }
}

function playPad(freq, vel, time, dur) {
    // Rich pad sound with multiple oscillators
    const oscs = [];
    const detunes = [-7, 0, 7, 12]; // Chord
    
    detunes.forEach(detune => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune * 100;
        
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        filter.Q.value = 1;
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(vel * 0.1, time + 0.3);
        gain.gain.linearRampToValueAtTime(0.01, time + dur);
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        
        osc.start(time);
        osc.stop(time + dur);
    });
}

function createNoiseBuffer(duration) {
    const bufferSize = audioContext.sampleRate * duration;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;
    return noise;
}

// =============================================
// 🎵 SAMPLE MANAGEMENT
// =============================================

function addSamplePad(sample) {
    const pad = document.createElement('div');
    pad.className = 'sample-pad';
    pad.dataset.sampleId = sample.id;
    
    pad.innerHTML = `
        <div class="sample-number">#${samples.length}</div>
        <div class="sample-instrument">${getInstrumentIcon(sample.instrument)} ${sample.instrument}</div>
        <button class="sample-delete" onclick="deleteSample(${sample.id})">×</button>
    `;
    
    pad.addEventListener('click', (e) => {
        if (!e.target.classList.contains('sample-delete')) {
            playSample(sample);
        }
    });
    
    samplePads.appendChild(pad);
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

function playSample(sample) {
    const pad = document.querySelector(`[data-sample-id="${sample.id}"]`);
    if (pad) {
        pad.classList.add('playing');
        setTimeout(() => pad.classList.remove('playing'), 500);
    }
    
    const now = audioContext.currentTime;
    const beatInterval = 60 / sample.tempo;
    
    sample.beats.forEach((beat, index) => {
        const playTime = now + index * beatInterval;
        playNote(beat, sample.instrument, playTime);
    });
}

function deleteSample(sampleId) {
    samples = samples.filter(s => s.id !== sampleId);
    const pad = document.querySelector(`[data-sample-id="${sampleId}"]`);
    if (pad) pad.remove();
    
    if (samples.length === 0) {
        playButton.disabled = true;
        stopButton.disabled = true;
    }
}

clearSamplesBtn.addEventListener('click', () => {
    if (confirm('Effacer tous les samples ?')) {
        samples = [];
        samplePads.innerHTML = '';
        playButton.disabled = true;
        stopButton.disabled = true;
    }
});

// =============================================
// ▶️ PLAYBACK SYSTEM
// =============================================

playButton.addEventListener('click', () => {
    if (!isPlaying) {
        startPlayback();
    }
});

stopButton.addEventListener('click', () => {
    stopPlayback();
});

loopButton.addEventListener('click', () => {
    loopEnabled = !loopEnabled;
    loopButton.classList.toggle('active');
});

function startPlayback() {
    if (samples.length === 0) return;
    
    isPlaying = true;
    playButton.classList.add('playing');
    updateStatus('playing', 'Lecture...');
    
    playAllSamples();
}

function playAllSamples() {
    if (!isPlaying) return;
    
    const now = audioContext.currentTime;
    const beatInterval = 60 / currentTempo;
    
    // Play all samples simultaneously
    samples.forEach(sample => {
        sample.beats.forEach((beat, index) => {
            const playTime = now + index * beatInterval * (sample.tempo / currentTempo);
            playNote(beat, sample.instrument, playTime);
        });
    });
    
    // Loop if enabled
    if (loopEnabled) {
        const longestSample = Math.max(...samples.map(s => s.beats.length));
        const loopDuration = longestSample * beatInterval * 1000;
        setTimeout(playAllSamples, loopDuration);
    } else {
        isPlaying = false;
        playButton.classList.remove('playing');
        updateStatus('inactive', 'Prêt');
    }
}

function stopPlayback() {
    isPlaying = false;
    playButton.classList.remove('playing');
    updateStatus('inactive', 'Prêt');
}

// =============================================
// 🎛️ CONTROLS
// =============================================

tempoSlider.addEventListener('input', (e) => {
    currentTempo = parseInt(e.target.value);
    tempoDisplay.textContent = currentTempo;
    tempoValue.textContent = `${currentTempo} BPM`;
});

volumeSlider.addEventListener('input', (e) => {
    mainVolume = parseInt(e.target.value) / 100;
    volumeDisplay.textContent = parseInt(e.target.value);
    if (masterGain) masterGain.gain.value = mainVolume;
});

instrumentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        instrumentBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentInstrument = btn.dataset.instrument;
    });
});

// =============================================
// 📊 UI UPDATES
// =============================================

function updateStatus(status, text) {
    recordingStatus.dataset.status = status;
    statusText.textContent = text;
}

function updateTimer() {
    if (!isRecording) return;
    const elapsed = audioContext.currentTime - recordingStartTime;
    recordingTimer.textContent = `${elapsed.toFixed(1)}s`;
    requestAnimationFrame(updateTimer);
}

function updateAnalysisDisplay(analysis) {
    notesCount.textContent = analysis.count;
    patternDuration.textContent = `${analysis.duration}s`;
    patternType.textContent = analysis.type;
    patternComplexity.textContent = analysis.complexity;
    tempoValue.textContent = `${analysis.tempo} BPM`;
}

function visualizeWaveform() {
    if (!isRecording) return;
    
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    
    ctx.fillStyle = 'rgba(45, 55, 72, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#d4af37';
    ctx.beginPath();
    
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    
    requestAnimationFrame(visualizeWaveform);
}

// =============================================
// 🎬 INITIALIZATION
// =============================================

beatGrid.innerHTML = '<p style="color: #718096; font-style: italic;">Les beats détectés apparaîtront ici</p>';

console.log('🎵 SoundRhythm Studio initialized');

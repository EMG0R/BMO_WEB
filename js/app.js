// app.js

async function setup() {

    // Keep screen awake
    async function keepAwake() {
        try {
            if (document.visibilityState === 'visible') {
                const wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock is active');
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }
    
    document.addEventListener("visibilitychange", keepAwake);
    keepAwake();

    // Resume AudioContext on visibility change
    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();

    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === 'visible') {
            if (context.state === 'suspended') {
                context.resume().then(() => {
                    console.log('AudioContext resumed');
                });
            }
        }
    });

    const patchExportURL = "export/patch.export.json";
    const outputNode = context.createGain();
    outputNode.connect(context.destination);

    let response, patcher;
    try {
        response = await fetch(patchExportURL);
        patcher = await response.json();
        if (!window.RNBO) {
            await loadRNBOScript(patcher.desc.meta.rnboversion);
        }
    } catch (err) {
        handleError(err, response);
        return;
    }

    let dependencies = [];
    try {
        const dependenciesResponse = await fetch("export/dependencies.json");
        dependencies = await dependenciesResponse.json();
        dependencies = dependencies.map(d => d.file ? { ...d, file: "export/" + d.file } : d);
    } catch (e) { }

    let device;
    try {
        device = await RNBO.createDevice({ context, patcher });
    } catch (err) {
        handleError(err);
        return;
    }

    if (dependencies.length) await device.loadDataBufferDependencies(dependencies);
    device.node.connect(outputNode);

    makeSliders(device);
    makeOffsetSlider(device); // Add this line
    attachOutports(device);
    loadPresets(device, patcher);
    makeMIDIKeyboard(device);
    setupGridControl(device);
    initializePianoKeyboard(device);

    document.body.onclick = () => context.resume();

    if (typeof guardrails === "function") guardrails();
}

// Load RNBO script dynamically
function loadRNBOScript(version) {
    return new Promise((resolve, reject) => {
        if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
            throw new Error("Patcher exported with a Debug Version! Specify correct RNBO version.");
        }
        const el = document.createElement("script");
        el.src = `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;
        el.onload = resolve;
        el.onerror = () => reject(new Error(`Failed to load rnbo.js v${version}`));
        document.body.append(el);
    });
}

// Error handling for fetch and RNBO setup
function handleError(err, response) {
    const errorContext = { error: err };
    if (response && (response.status < 200 || response.status >= 300)) {
        errorContext.header = "Couldn't load patcher export bundle";
        errorContext.description = `Check app.js. Currently trying to load "${patchExportURL}".`;
    }
    if (typeof guardrails === "function") {
        guardrails(errorContext);
    } else {
        throw err;
    }
}

// Setup sliders for RNBO parameters
function makeSliders(device) {
    let pdiv = document.getElementById("rnbo-parameter-sliders");
    let noParamLabel = document.getElementById("no-param-label");
    if (noParamLabel && device.numParameters > 0) pdiv.removeChild(noParamLabel);

    let isDraggingSlider = false;
    let uiElements = {};

    device.parameters.forEach(param => {
        let sliderContainer = createSliderUI(param);
        uiElements[param.id] = sliderContainer.uiElements;

        pdiv.appendChild(sliderContainer.element);
    });

    device.parameterChangeEvent.subscribe(param => {
        if (!isDraggingSlider) {
            uiElements[param.id].slider.value = param.value;
        }
        uiElements[param.id].text.value = param.value.toFixed(1);
    });
}

// Function to create a slider for the offset parameter
function makeOffsetSlider(device) {
    const pdiv = document.getElementById("offset-slider-container");

    // Clear any existing slider elements
    pdiv.innerHTML = ""; // Remove any previous slider to avoid duplicates

    // Log available parameters to debug
    console.log("Available Parameters:", device.parameters.map(p => p.name));

    // Find the offset parameter
    const offsetParam = device.parameters.find(param => param.name === "offset"); // Adjust if the name is different

    if (!offsetParam) {
        console.error("Offset parameter not found");
        return; // Exit if the parameter is not found
    }

    // Create the slider element
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = offsetParam.min;
    slider.max = offsetParam.max;
    slider.step = offsetParam.steps > 1 ? (offsetParam.max - offsetParam.min) / (offsetParam.steps - 1) : (offsetParam.max - offsetParam.min) / 1000;
    slider.value = offsetParam.value;
    slider.className = "parameter-slider offset-slider"; // Add a class for styling

    // Update the background gradient based on slider value
    const updateSliderGradient = () => {
        const percentage = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--thumb-position', `${percentage}%`); // Set CSS variable for gradient
        offsetParam.value = parseFloat(slider.value);
    };

    // Event listener for slider input
    slider.addEventListener("input", updateSliderGradient);

    // Append the slider to the container
    pdiv.appendChild(slider);

    // Set the initial value of the slider based on the parameter value
    updateSliderGradient(); // Initialize the gradient

    // Subscribe to parameter changes
    if (offsetParam.updateEvent) {
        offsetParam.updateEvent.subscribe((param) => {
            slider.value = param.value;
            updateSliderGradient(); // Update the gradient when the parameter changes
        });
    } else {
        console.error("No update event found for the offset parameter.");
    }
}





function createSliderUI(param) {
    let label = document.createElement("label");
    let slider = document.createElement("input");
    let text = document.createElement("input");
    let sliderContainer = document.createElement("div");

    label.textContent = `${param.name}: `;
    label.className = "param-label";
    slider.type = "range";
    slider.min = param.min;
    slider.max = param.max;
    slider.step = param.steps > 1 ? (param.max - param.min) / (param.steps - 1) : (param.max - param.min) / 1000;
    slider.value = param.value;
    text.type = "text";
    text.value = param.value.toFixed(1);

    slider.addEventListener("input", () => {
        param.value = parseFloat(slider.value);
        text.value = param.value.toFixed(1);
    });

    text.addEventListener("change", () => {
        let newValue = parseFloat(text.value);
        if (!isNaN(newValue)) {
            newValue = Math.max(param.min, Math.min(param.max, newValue));
            param.value = newValue;
            slider.value = newValue;
        }
    });

    sliderContainer.append(label, slider, text);

    return {
        element: sliderContainer,
        uiElements: { slider, text }
    };
}

// Initialize piano keyboard interaction
function initializePianoKeyboard(device) {
    document.querySelectorAll('.white-key, .black-key').forEach(key => {
        key.addEventListener('mousedown', () => {
            key.classList.add('pressed');
            const note = parseInt(key.getAttribute('data-note'));
            playMIDINote(device, note);
            console.log(`Note ${note} pressed`);
        });
        key.addEventListener('mouseup', () => {
            key.classList.remove('pressed');
        });
    });
}

// Function to play a MIDI note
function playMIDINote(device, note) {
    let midiChannel = 0;

    let noteOnMessage = [144 + midiChannel, note, 100];
    let noteOffMessage = [128 + midiChannel, note, 0];
    let midiPort = 0;
    let noteDurationMs = 250;

    let noteOnEvent = new RNBO.MIDIEvent(device.context.currentTime * 1000, midiPort, noteOnMessage);
    let noteOffEvent = new RNBO.MIDIEvent(device.context.currentTime * 1000 + noteDurationMs, midiPort, noteOffMessage);

    device.scheduleEvent(noteOnEvent);
    device.scheduleEvent(noteOffEvent);
}

function setupGridControl(device) {
    const gridContainer = document.getElementById('grid-container');

    function calculateXY(clientX, clientY) {
        const rect = gridContainer.getBoundingClientRect();
        const x = Math.min(127, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 128)));
        const y = Math.min(127, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * 128)));
        return { x, y };
    }

    function updateRNBOValues(x, y) {
        const paramX = device.parameters.find(param => param.id.includes("X"));
        const paramY = device.parameters.find(param => param.id.includes("Y"));
        if (paramX) paramX.value = x;
        if (paramY) paramY.value = y;
    }

    function createSpark(pageX, pageY) {
        const spark = document.createElement("div");
        spark.classList.add("spark");
        
        // Smaller spark size
        const size = Math.random() * 8 + 3; // Sparkles will be between 3px and 11px
        spark.style.width = `${size}px`;
        spark.style.height = `${size}px`; // Ensure width and height are the same for circular sparkles

        const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
        spark.style.backgroundColor = randomColor;

        // Position the spark at the mouse/touch coordinates
        spark.style.left = `${pageX}px`;
        spark.style.top = `${pageY}px`;

        // Increase the movement range of sparkles
        const angle = Math.random() * 360;
        const speed = Math.random() * 30 + 10; // Longer range for more movement
        spark.style.transform = `translate(${Math.cos(angle) * speed}px, ${Math.sin(angle) * speed}px)`;

        document.body.appendChild(spark);

        setTimeout(() => {
            spark.remove();
        }, 1000);
    }

    document.getElementById("glitch-button").addEventListener("click", function() {
        const glitchParam = device.parameters.find(param => param.id.includes("glitch")); // Adjust to match your parameter's ID
        if (glitchParam) {
            if (glitchParam.value === 0) {
                glitchParam.value = 127; // Engage the glitch
                this.style.backgroundColor = '#C0C0C0'; // Change to silver
            } else {
                glitchParam.value = 0; // Turn off the glitch
                this.style.backgroundColor = '#808080'; // Change back to grey
            }
        }
    });
    

    function updateCoordinates(event) {
        event.preventDefault();
        let clientX, clientY, pageX, pageY;

        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
            pageX = event.touches[0].pageX;
            pageY = event.touches[0].pageY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
            pageX = event.pageX;
            pageY = event.pageY;
        }

        const { x, y } = calculateXY(clientX, clientY);

        // Update RNBO with X and Y values
        updateRNBOValues(x, y);

        // Create a spark trail at the touch/mouse position
        createSpark(pageX, pageY);
    }

    // Event listeners for touch/mouse events
    gridContainer.addEventListener('touchmove', updateCoordinates);
    gridContainer.addEventListener('mousemove', updateCoordinates);

    gridContainer.addEventListener('touchstart', (event) => {
        updateCoordinates(event);
    });

    gridContainer.addEventListener('mouseenter', updateCoordinates);
}


// Attach listeners to RNBO outports
function attachOutports(device) {
    const outports = device.outports;
    const consoleDiv = document.getElementById("rnbo-console-div");
    const noOutportsLabel = document.getElementById("no-outports-label");

    if (outports.length === 0 && consoleDiv) {
        document.getElementById("rnbo-console").removeChild(consoleDiv);
        return;
    }
    if (noOutportsLabel) {
        document.getElementById("rnbo-console").removeChild(noOutportsLabel);
    }

    device.messageEvent.subscribe((ev) => {
        if (outports.findIndex(elt => elt.tag === ev.tag) < 0) return;
        console.log(`${ev.tag}: ${ev.payload}`);
        document.getElementById("rnbo-console-readout").innerText = `${ev.tag}: ${ev.payload}`;
    });
}

// Load RNBO presets
function loadPresets(device, patcher) {
    const presets = patcher.presets || [];
    if (presets.length === 0) return;

    const presetSelect = document.getElementById("preset-select");
    const noPresetsLabel = document.getElementById("no-presets-label");

    if (noPresetsLabel) {
        document.getElementById("rnbo-presets").removeChild(noPresetsLabel);
    }

    presets.forEach((preset, index) => {
        const option = document.createElement("option");
        option.innerText = preset.name;
        option.value = index;
        presetSelect.appendChild(option);
    });

    presetSelect.onchange = () => device.setPreset(presets[presetSelect.value].preset);
}

// Initialize MIDI keyboard
function makeMIDIKeyboard(device) {
    const mdiv = document.getElementById("rnbo-clickable-keyboard");
    const noMidiLabel = document.getElementById("no-midi-label");
    if (device.numMIDIInputPorts === 0) return;

    if (noMidiLabel) {
        mdiv.removeChild(noMidiLabel);
    }

    const midiNotes = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
    midiNotes.forEach(note => {
        const key = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = note;
        key.appendChild(label);

        key.addEventListener("pointerdown", () => {
            playMIDINote(device, note);
            key.classList.add("clicked");
        });

        key.addEventListener("pointerup", () => key.classList.remove("clicked"));

        mdiv.appendChild(key);
    });
}

// Call the setup function
setup();

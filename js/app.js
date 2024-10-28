// app.js

async function setup() {

    
    // WORK OFF???
    async function keepAwake() {
        try {
            const wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock is active');
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }
    
    // Call keepAwake when the page loads
    keepAwake();

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

    // Create AudioContext
    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();

    // Create gain node and connect it to audio output
    const outputNode = context.createGain();
    outputNode.connect(context.destination);

    // Fetch the exported patcher
    let response, patcher;
    try {
        response = await fetch(patchExportURL);
        patcher = await response.json();

        if (!window.RNBO) {
            // Load RNBO script dynamically
            await loadRNBOScript(patcher.desc.meta.rnboversion);
        }

    } catch (err) {
        const errorContext = { error: err };
        if (response && (response.status >= 300 || response.status < 200)) {
            errorContext.header = `Couldn't load patcher export bundle`;
            errorContext.description = `Check app.js to see what file it's trying to load. Currently it's` +
                ` trying to load "${patchExportURL}". If that doesn't` +
                ` match the name of the file you exported from RNBO, modify` +
                ` patchExportURL in app.js.`;
        }
        if (typeof guardrails === "function") {
            guardrails(errorContext);
        } else {
            throw err;
        }
        return;
    }

    // Fetch the dependencies
    let dependencies = [];
    try {
        const dependenciesResponse = await fetch("export/dependencies.json");
        dependencies = await dependenciesResponse.json();
        dependencies = dependencies.map(d => d.file ? { ...d, file: "export/" + d.file } : d);
    } catch (e) { }

    // Create the device
    let device;
    try {
        device = await RNBO.createDevice({ context, patcher });
    } catch (err) {
        if (typeof guardrails === "function") {
            guardrails({ error: err });
        } else {
            throw err;
        }
        return;
    }

    // Load the samples
    if (dependencies.length) await device.loadDataBufferDependencies(dependencies);

    // Connect the device to the web audio graph
    device.node.connect(outputNode);

    // Automatically create sliders for the device parameters
    makeSliders(device);

    // Attach listeners to outports so you can log messages from the RNBO patcher
    attachOutports(device);

    // Load presets, if any
    loadPresets(device, patcher);

    // Connect MIDI inputs
    makeMIDIKeyboard(device);

    // Setup grid control for X and Y parameters
    setupGridControl(device);

    document.body.onclick = () => {
        context.resume();
    };

    // Skip if you're not using guardrails.js
    if (typeof guardrails === "function") guardrails();
}

function loadRNBOScript(version) {
    return new Promise((resolve, reject) => {
        if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
            throw new Error("Patcher exported with a Debug Version!\nPlease specify the correct RNBO version to use in the code.");
        }
        const el = document.createElement("script");
        el.src = "https://c74-public.nyc3.digitaloceanspaces.com/rnbo/" + encodeURIComponent(version) + "/rnbo.min.js";
        el.onload = resolve;
        el.onerror = function (err) {
            console.log(err);
            reject(new Error("Failed to load rnbo.js v" + version));
        };
        document.body.append(el);
    });
}

function makeSliders(device) {
    let pdiv = document.getElementById("rnbo-parameter-sliders");
    let noParamLabel = document.getElementById("no-param-label");
    if (noParamLabel && device.numParameters > 0) pdiv.removeChild(noParamLabel);

    // This will allow us to ignore parameter update events while dragging the slider.
    let isDraggingSlider = false;
    let uiElements = {};

    device.parameters.forEach(param => {
        // Uncomment the following line if you want to exclude subpatcher params
        // if (param.id.includes("/")) return;

        // Create a label, an input slider, and a value display
        let label = document.createElement("label");
        let slider = document.createElement("input");
        let text = document.createElement("input");
        let sliderContainer = document.createElement("div");
        sliderContainer.appendChild(label);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(text);

        // Add a name for the label
        label.setAttribute("name", param.name);
        label.setAttribute("for", param.name);
        label.setAttribute("class", "param-label");
        label.textContent = `${param.name}: `;

        // Make each slider reflect its parameter
        slider.setAttribute("type", "range");
        slider.setAttribute("class", "param-slider");
        slider.setAttribute("id", param.id);
        slider.setAttribute("name", param.name);
        slider.setAttribute("min", param.min);
        slider.setAttribute("max", param.max);
        if (param.steps > 1) {
            slider.setAttribute("step", (param.max - param.min) / (param.steps - 1));
        } else {
            slider.setAttribute("step", (param.max - param.min) / 1000.0);
        }
        slider.setAttribute("value", param.value);

        // Make a settable text input display for the value
        text.setAttribute("value", param.value.toFixed(1));
        text.setAttribute("type", "text");

        // Make each slider control its parameter
        slider.addEventListener("pointerdown", () => {
            isDraggingSlider = true;
        });
        slider.addEventListener("pointerup", () => {
            isDraggingSlider = false;
            slider.value = param.value;
            text.value = param.value.toFixed(1);
        });
        slider.addEventListener("input", () => {
            let value = Number.parseFloat(slider.value);
            param.value = value;
        });

        // Make the text box input control the parameter value as well
        text.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                let newValue = Number.parseFloat(text.value);
                if (isNaN(newValue)) {
                    text.value = param.value;
                } else {
                    newValue = Math.min(newValue, param.max);
                    newValue = Math.max(newValue, param.min);
                    text.value = newValue;
                    param.value = newValue;
                }
            }
        });

        // Store the slider and text input for parameter update
        uiElements[param.id] = { slider, text };

        // Add the slider element
        pdiv.appendChild(sliderContainer);
    });

    // Listen to parameter changes from the device
    device.parameterChangeEvent.subscribe(param => {
        if (!isDraggingSlider) {
            uiElements[param.id].slider.value = param.value;
        }
        uiElements[param.id].text.value = param.value.toFixed(1);
    });
}

function setupGridControl(device) {
    const gridContainer = document.getElementById('grid-container');
    const fingerDot = document.getElementById('finger-dot');

    // Function to calculate X and Y from touch or mouse position
    function calculateXY(clientX, clientY) {
        const rect = gridContainer.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 127;
        const y = ((clientY - rect.top) / rect.height) * 127;
        return {
            x: Math.min(127, Math.max(0, x)),
            y: Math.min(127, Math.max(0, y))
        };
    }

    // Function to send X and Y values to RNBO using the same method as sliders
    function updateRNBOValues(x, y) {
        // Find the parameters by index if they are parameters 0 and 1
        // Or adjust the code to find parameters by name or id if necessary
        const paramX = device.parameters[1]; // Assuming X is parameter at index 1
        const paramY = device.parameters[0]; // Assuming Y is parameter at index 0

        // Log parameter IDs and names to verify
        // console.log("Parameters:", device.parameters);

        if (paramX) {
            paramX.value = x;
        }
        if (paramY) {
            paramY.value = y;
        }
    }

    // Update coordinates and send to RNBO
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

        // Update the finger dot position on the grid (using clientX/clientY for viewport)
        const rect = gridContainer.getBoundingClientRect();
        const relativeX = clientX - rect.left;
        const relativeY = clientY - rect.top;

        fingerDot.style.left = `${relativeX}px`;
        fingerDot.style.top = `${relativeY}px`;

        // Create spark trail (if you have the createSpark function)
        // createSpark(pageX, pageY);
    }

    // Event listeners for touch/mouse events
    gridContainer.addEventListener('touchmove', updateCoordinates);
    gridContainer.addEventListener('mousemove', updateCoordinates);

    gridContainer.addEventListener('touchstart', (event) => {
        fingerDot.style.display = 'block';
        updateCoordinates(event);
    });

    gridContainer.addEventListener('touchend', () => {
        fingerDot.style.display = 'none';
    });

    gridContainer.addEventListener('mouseenter', () => {
        fingerDot.style.display = 'block';
    });

    gridContainer.addEventListener('mouseleave', () => {
        fingerDot.style.display = 'none';
    });

    // Hide the finger dot initially
    fingerDot.style.display = 'none';
}

function attachOutports(device) {
    const outports = device.outports;
    if (outports.length < 1) {
        document.getElementById("rnbo-console").removeChild(document.getElementById("rnbo-console-div"));
        return;
    }

    document.getElementById("rnbo-console").removeChild(document.getElementById("no-outports-label"));
    device.messageEvent.subscribe((ev) => {
        if (outports.findIndex(elt => elt.tag === ev.tag) < 0) return;
        console.log(`${ev.tag}: ${ev.payload}`);
        document.getElementById("rnbo-console-readout").innerText = `${ev.tag}: ${ev.payload}`;
    });
}

function loadPresets(device, patcher) {
    let presets = patcher.presets || [];
    if (presets.length < 1) {
        document.getElementById("rnbo-presets").removeChild(document.getElementById("preset-select"));
        return;
    }

    document.getElementById("rnbo-presets").removeChild(document.getElementById("no-presets-label"));
    let presetSelect = document.getElementById("preset-select");
    presets.forEach((preset, index) => {
        const option = document.createElement("option");
        option.innerText = preset.name;
        option.value = index;
        presetSelect.appendChild(option);
    });
    presetSelect.onchange = () => device.setPreset(presets[presetSelect.value].preset);
}

function makeMIDIKeyboard(device) {
    let mdiv = document.getElementById("rnbo-clickable-keyboard");
    if (device.numMIDIInputPorts === 0) return;

    mdiv.removeChild(document.getElementById("no-midi-label"));

    const midiNotes = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
    midiNotes.forEach(note => {
        const key = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = note;
        key.appendChild(label);
        key.addEventListener("pointerdown", () => {
            let midiChannel = 0;

            let noteOnMessage = [
                144 + midiChannel, // Code for a note on: 10010000 & midi channel (0-15)
                note, // MIDI Note
                100 // MIDI Velocity
            ];

            let noteOffMessage = [
                128 + midiChannel, // Code for a note off: 10000000 & midi channel (0-15)
                note, // MIDI Note
                0 // MIDI Velocity
            ];

            let midiPort = 0;
            let noteDurationMs = 250;

            let noteOnEvent = new RNBO.MIDIEvent(device.context.currentTime * 1000, midiPort, noteOnMessage);
            let noteOffEvent = new RNBO.MIDIEvent(device.context.currentTime * 1000 + noteDurationMs, midiPort, noteOffMessage);

            device.scheduleEvent(noteOnEvent);
            device.scheduleEvent(noteOffEvent);

            key.classList.add("clicked");
        });

        key.addEventListener("pointerup", () => key.classList.remove("clicked"));

        mdiv.appendChild(key);
    });
}

// Run the setup function
setup();

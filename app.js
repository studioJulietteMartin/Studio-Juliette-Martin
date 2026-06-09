const viewport = document.getElementById('viewport');
const mapCanvas = document.getElementById('mapCanvas');
const ticker = document.getElementById('statusTicker');
const zoomLevelText = document.getElementById('zoomLevel');

const ZOOM_FOCUS = {
    name: 'Switzerland',
    lat: 47.37,
    lon: 8.54
};

const STUDIO_PROJECTS = [
    { name: "PROJ_ARARAT", lat: 39.70, lon: 44.30, details: "Standalone Tonir Assembly" },
    { name: "PROJ_ZURICH", lat: 47.37, lon: 8.54, details: "SBC Collaboration" },
    { name: "PROJ_NEUCHATEL", lat: 47.10, lon: 6.83, details: "Urban Heritage Survey" }
];

const VOLCANO_API = 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson';

function convertCoordsToPercentages(lat, lon) {
    const x = ((lon + 180) / 360) * 100;
    const y = ((90 - lat) / 180) * 100;
    return { x, y };
}

function plotStudioProjects() {
    STUDIO_PROJECTS.forEach(proj => {
        const pos = convertCoordsToPercentages(proj.lat, proj.lon);
        const marker = document.createElement('div');
        marker.className = 'project-marker';
        marker.style.left = `${pos.x}%`;
        marker.style.top = `${pos.y}%`;
        marker.innerHTML = `
            <div class="label" style="border-color: #fff; color: #fff;">
                <strong>[PROJECT] ${proj.name}</strong><br>
                LOC: ${proj.lat.toFixed(2)}N, ${proj.lon.toFixed(2)}E<br>
                DATA: ${proj.details}
            </div>
        `;
        mapCanvas.appendChild(marker);
    });
}

async function updateVolcanicTelemetry() {
    try {
        const response = await fetch(VOLCANO_API);
        const data = await response.json();
        
        const existingDots = mapCanvas.querySelectorAll('.activity-dot');
        existingDots.forEach(dot => dot.remove());
        
        let highAlertCount = 0;
        let maxSeverity = 0; 

        data.features.forEach(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            const props = feature.properties;
            const name = props.volcanoName;
            const status = props.colorCode ? props.colorCode.toUpperCase() : 'GREEN';

            if (status !== 'GREEN' && status !== 'UNASSIGNED') {
                highAlertCount++;
                if (status === 'YELLOW') maxSeverity = Math.max(maxSeverity, 1);
                if (status === 'ORANGE') maxSeverity = Math.max(maxSeverity, 2);
                if (status === 'RED') maxSeverity = Math.max(maxSeverity, 3);

                const pos = convertCoordsToPercentages(lat, lon);
                const dot = document.createElement('div');
                dot.className = 'activity-dot';
                dot.style.left = `${pos.x}%`;
                dot.style.top = `${pos.y}%`;

                dot.innerHTML = `
                    <div class="label">
                        <strong>${name}</strong><br>
                        STATUS: ${status} WATCH<br>
                        RAD: ${lat.toFixed(2)}N / ${lon.toFixed(2)}E
                    </div>
                `;
                mapCanvas.appendChild(dot);
            }
        });

        const weights = ['200', '400', '700', '900'];
        const scales = ['1', '1.05', '1.1', '1.15'];
        document.documentElement.style.setProperty('--studio-weight', weights[maxSeverity]);
        document.documentElement.style.setProperty('--studio-scale', scales[maxSeverity]);

        ticker.innerText = `SYS_LIVE // FAULT_ANOMALIES: ${highAlertCount} // FIXED_ASSETS: ${STUDIO_PROJECTS.length}`;
    } catch (err) {
        ticker.innerText = "SYS_OFFLINE // STATIC_DATA_ACTIVE";
    }
}

// --- SNAPPY BINARY SCROLL WHEEL CONTROLLER ---
let isZoomed = false;
const maxZoom = 14; 
const targetPos = convertCoordsToPercentages(ZOOM_FOCUS.lat, ZOOM_FOCUS.lon);

document.addEventListener('wheel', (e) => {
    if (!viewport.contains(e.target)) {
        return;
    }

    if (e.deltaY < 0 && !isZoomed) {
        e.preventDefault();
        const translateX = (50 - targetPos.x) * maxZoom;
        const translateY = (50 - targetPos.y) * maxZoom;
        
        document.documentElement.style.setProperty('--zoom-factor', maxZoom);
        mapCanvas.style.transform = `translate(${translateX}%, ${translateY}%) scale(${maxZoom})`;
        zoomLevelText.innerText = `VIEWPORT SCALED: ${ZOOM_FOCUS.name.toUpperCase()} CORE [14.0x]`;
        isZoomed = true;
    } 
    else if (e.deltaY > 0 && isZoomed) {
        e.preventDefault();
        document.documentElement.style.setProperty('--zoom-factor', 1);
        mapCanvas.style.transform = `scale(1) translate(0%, 0%)`;
        zoomLevelText.innerText = "VIEWPORT SCALED: MACRO [1.0x]";
        isZoomed = false;
    }
}, { passive: false });

plotStudioProjects();
updateVolcanicTelemetry();
setInterval(updateVolcanicTelemetry, 300000);

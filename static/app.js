// Number of ping requests used to find the round-trip time.
const PING_SAMPLE_COUNT = 10;

// Object sizes in bytes, tried from smallest to largest.
const OBJECT_SIZES = [
  25_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000,
];

// Number of connections that transfer data at the same time.
const PARALLEL_CONNECTIONS = 4;

// A connection moves to a larger object if one finishes faster than this.
const TARGET_OBJECT_TIME_MS = 300;

// How often the speed is checked.
const SAMPLE_INTERVAL_MS = 250;

// Speeds from the start of a test are ignored while TCP speeds up.
const RAMP_UP_TIME_MS = 1000;

// Number of samples used to calculate each speed (4 samples is 1 second).
const SPEED_WINDOW_SAMPLES = 4;

// The test stops once this many speeds in a row are close to each other.
const STABLE_SPEED_COUNT = 3;

// "Close" means the speeds are within 10% of the fastest one.
const STABILITY_TOLERANCE = 0.1;

// Hard limits for one download or upload test.
const MAX_TEST_TIME_MS = 8000;
const MAX_TEST_BYTES = 300_000_000;

// The most random bytes the browser can generate in one call.
const MAX_RANDOM_CHUNK_SIZE = 65_536;

// Find the page elements this script needs to use.
const startButton = document.getElementById("start-button");
const statusText = document.getElementById("status");
const pingValue = document.getElementById("ping-value");
const downloadValue = document.getElementById("download-value");
const uploadValue = document.getElementById("upload-value");

// Random data sent to the server, large enough for the biggest object.
// A Blob lets the browser send it without slowing down this script.
const uploadData = new Blob([createRandomData(OBJECT_SIZES[OBJECT_SIZES.length - 1])]);

// Returns an array of random bytes of the given size.
function createRandomData(size) {
  const data = new Uint8Array(size);

  for (let start = 0; start < size; start += MAX_RANDOM_CHUNK_SIZE) {
    const end = Math.min(start + MAX_RANDOM_CHUNK_SIZE, size);
    crypto.getRandomValues(data.subarray(start, end));
  }

  return data;
}

// Returns a promise that finishes after the given time.
function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

// Converts bytes and milliseconds to megabits per second.
function calculateSpeedMbps(bytes, durationMs) {
  return (bytes * 8) / (durationMs * 1000);
}

// Sends one request to the server and returns how long it took in milliseconds.
async function measureSinglePing() {
  const startTime = performance.now();
  const response = await fetch("/ping", { cache: "no-store" });
  const endTime = performance.now();

  if (!response.ok) {
    throw new Error("Ping request failed");
  }

  return endTime - startTime;
}

// Returns the lowest round-trip time from several ping requests.
async function measurePing() {
  // The first request also opens the connection, so its time is not used.
  await measureSinglePing();

  let lowestPing = Infinity;
  for (let sample = 0; sample < PING_SAMPLE_COUNT; sample++) {
    const pingTime = await measureSinglePing();
    if (pingTime < lowestPing) {
      lowestPing = pingTime;
    }
  }

  return lowestPing;
}

// Downloads one object, adding the bytes to the progress as they arrive.
async function downloadObject(size, progress) {
  const response = await fetch(`/download?size=${size}`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Download request failed");
  }

  // Read the data piece by piece as it arrives, counting the bytes.
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    progress.transferredBytes += value.length;
  }
}

// Uploads one object, adding the bytes to the progress as they are sent.
// This uses XMLHttpRequest because fetch cannot report upload progress.
function uploadObject(size, progress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let countedBytes = 0;

    request.open("POST", "/upload");

    request.upload.onprogress = (event) => {
      progress.transferredBytes += event.loaded - countedBytes;
      countedBytes = event.loaded;
    };

    request.onload = () => {
      if (request.status !== 200) {
        reject(new Error("Upload request failed"));
        return;
      }

      // Replace the browser's count with the exact number the server received.
      progress.transferredBytes += Number(request.responseText) - countedBytes;
      resolve();
    };

    request.onerror = () => reject(new Error("Upload request failed"));

    request.send(uploadData.slice(0, size));
  });
}

// Transfers objects one after another on a single connection until told to
// stop, moving to larger objects while they finish quickly.
async function runConnection(transferObject, progress) {
  let sizeIndex = 0;

  while (progress.keepRunning && progress.transferredBytes < MAX_TEST_BYTES) {
    const startTime = performance.now();
    await transferObject(OBJECT_SIZES[sizeIndex], progress);
    const durationMs = performance.now() - startTime;

    const hasLargerObject = sizeIndex < OBJECT_SIZES.length - 1;
    if (durationMs < TARGET_OBJECT_TIME_MS && hasLargerObject) {
      sizeIndex++;
    }
  }
}

// Returns true when the most recent speeds are close to each other.
function isSpeedStable(speeds) {
  if (speeds.length < STABLE_SPEED_COUNT) {
    return false;
  }

  const recentSpeeds = speeds.slice(-STABLE_SPEED_COUNT);
  const fastestSpeed = Math.max(...recentSpeeds);
  const slowestSpeed = Math.min(...recentSpeeds);

  return fastestSpeed > 0 && fastestSpeed - slowestSpeed <= fastestSpeed * STABILITY_TOLERANCE;
}

// Runs one download or upload test and returns the final speed in Mbps.
async function measureSpeed(transferObject, valueElement) {
  const progress = { transferredBytes: 0, keepRunning: true };
  const startTime = performance.now();

  const connections = [];
  for (let connection = 0; connection < PARALLEL_CONNECTIONS; connection++) {
    connections.push(runConnection(transferObject, progress));
  }

  const samples = [{ timeMs: startTime, bytes: 0 }];
  const speeds = [];
  let speedMbps = 0;

  // Check the speed regularly until it is stable or a limit is reached.
  while (progress.keepRunning) {
    await wait(SAMPLE_INTERVAL_MS);

    const sample = { timeMs: performance.now(), bytes: progress.transferredBytes };
    samples.push(sample);

    const windowStart = samples[Math.max(0, samples.length - 1 - SPEED_WINDOW_SAMPLES)];
    speedMbps = calculateSpeedMbps(
      sample.bytes - windowStart.bytes,
      sample.timeMs - windowStart.timeMs,
    );
    valueElement.textContent = speedMbps.toFixed(1);

    const elapsedMs = sample.timeMs - startTime;
    if (elapsedMs >= RAMP_UP_TIME_MS) {
      speeds.push(speedMbps);
    }

    if (
      isSpeedStable(speeds) ||
      elapsedMs >= MAX_TEST_TIME_MS ||
      sample.bytes >= MAX_TEST_BYTES
    ) {
      progress.keepRunning = false;
    }
  }

  // Let the objects still in progress finish, so every byte is counted.
  await Promise.all(connections);

  return speedMbps;
}

// Runs when the user clicks the start button.
async function startTest() {
  startButton.disabled = true;
  pingValue.textContent = "--";
  downloadValue.textContent = "--";
  uploadValue.textContent = "--";

  try {
    statusText.textContent = "Measuring ping...";
    const ping = await measurePing();
    pingValue.textContent = ping.toFixed(1);

    statusText.textContent = "Measuring download speed...";
    await measureSpeed(downloadObject, downloadValue);

    statusText.textContent = "Measuring upload speed...";
    await measureSpeed(uploadObject, uploadValue);

    statusText.textContent = "Test complete";
  } catch (error) {
    statusText.textContent = "Test failed: could not reach the server";
  } finally {
    startButton.disabled = false;
  }
}

startButton.addEventListener("click", startTest);

// =====================================================================
// Speed test client
// Order of the test: 1) ping  2) download speed  3) upload speed
// =====================================================================

// ----- Settings -----
const PING_COUNT = 10;               // number of pings (we report the lowest)
const CONNECTIONS = 4;               // parallel connections, one alone can't fill a fast line
const FIRST_OBJECT_SIZE = 100_000;   // 100 KB, size of the first object on each connection
const BIGGEST_OBJECT_SIZE = 8_000_000; // 8 MB, objects never get bigger than this
const FAST_OBJECT_TIME = 250;        // ms, if an object finishes faster, the next one is 2x bigger
const CHECK_EVERY = 250;             // ms, how often we calculate the speed
const READINGS_PER_SECOND = 4;       // 4 checks x 250 ms = speed is measured over the last 1 second
const WARM_UP_TIME = 1000;           // ms, ignore the first second (TCP is still speeding up)
const READINGS_TO_COMPARE = 4;       // stop when the last 4 readings ...
const ALLOWED_DIFFERENCE = 0.10;     // ... are within 10% of each other
const MAX_TEST_TIME = 8000;          // ms, stop anyway after 8 seconds

// ----- Page elements -----
const startButton = document.getElementById("start-button");
const statusText = document.getElementById("status");
const pingValue = document.getElementById("ping-value");
const downloadValue = document.getElementById("download-value");
const uploadValue = document.getElementById("upload-value");
const downloadData = document.getElementById("download-data");
const uploadData = document.getElementById("upload-data");
const summaryText = document.getElementById("summary");

// The state of the download or upload test that is running now.
let test = { running: false, bytes: 0, openRequests: [] };

// Random data we upload. It is created when the test starts.
let uploadBlob = null;

// ----- Small helper functions -----

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// bytes in a number of milliseconds -> megabits per second
function toMbps(bytes, ms) {
  return (bytes * 8) / (ms * 1000);
}

// bytes -> text like "12.34 MB"
function toMB(bytes) {
  return (bytes / 1_000_000).toFixed(2) + " MB";
}

function average(numbers) {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum / numbers.length;
}

// True when the biggest and smallest reading are within 10% of each other.
function isStable(readings) {
  const biggest = Math.max(...readings);
  const smallest = Math.min(...readings);
  return biggest > 0 && biggest - smallest <= biggest * ALLOWED_DIFFERENCE;
}

// Makes random bytes for uploading. The browser can only make 65536 at a time.
function makeRandomBlob(size) {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) {
    crypto.getRandomValues(data.subarray(i, Math.min(i + 65536, size)));
  }
  return new Blob([data]);
}

// Removes a finished request from the list of open requests.
function forgetRequest(request) {
  test.openRequests = test.openRequests.filter((r) => r !== request);
}

// Stops the test and cancels every request that is still running,
// so we don't waste time and data finishing them.
function stopTest() {
  test.running = false;
  for (const request of test.openRequests) {
    request.abort();
  }
}

// ----- 1) Ping -----

// Sends one empty request and returns the round-trip time in ms.
async function pingOnce() {
  const start = performance.now();
  const response = await fetch("/ping", { cache: "no-store" });
  const time = performance.now() - start;
  if (!response.ok) throw new Error("ping failed");
  return time;
}

async function measurePing() {
  // The first ping also opens the connection, so it is slower. We don't count it.
  await pingOnce();

  let lowest = Infinity;
  for (let i = 0; i < PING_COUNT; i++) {
    const time = await pingOnce();
    lowest = Math.min(lowest, time);
  }
  return lowest;
}

// ----- 2) Download one object -----

async function downloadOne(size) {
  const controller = new AbortController(); // lets stopTest() cancel this download
  test.openRequests.push(controller);

  try {
    const response = await fetch("/download?size=" + size, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("download failed");

    // Count the bytes piece by piece while they arrive.
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      test.bytes += value.length;
    }
  } finally {
    forgetRequest(controller);
  }
}

// ----- 3) Upload one object -----
// We use XMLHttpRequest here because fetch() can't tell us upload progress.

function uploadOne(size) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let countedBytes = 0; // bytes of this object already added to test.bytes
    test.openRequests.push(xhr);

    xhr.upload.onprogress = (event) => {
      test.bytes += event.loaded - countedBytes;
      countedBytes = event.loaded;
    };

    xhr.onload = () => {
      forgetRequest(xhr);
      if (xhr.status !== 200) {
        reject(new Error("upload failed"));
        return;
      }
      test.bytes += size - countedBytes; // make sure the whole object is counted
      resolve();
    };

    xhr.onerror = () => {
      forgetRequest(xhr);
      reject(new Error("upload failed"));
    };

    xhr.onabort = () => {
      forgetRequest(xhr);
      reject(new Error("upload cancelled"));
    };

    xhr.open("POST", "/upload");
    xhr.send(uploadBlob.slice(0, size));
  });
}

// ----- Download / upload speed test -----

// One connection: transfers objects one after another until the test stops.
// Objects get bigger while they finish quickly, so slow and fast
// internet connections both get a sensible object size.
async function runConnection(transferOne) {
  let size = FIRST_OBJECT_SIZE;

  while (test.running) {
    const start = performance.now();
    try {
      await transferOne(size);
    } catch (error) {
      if (!test.running) return; // we cancelled it ourselves, that's fine
      throw error;               // a real error
    }

    const time = performance.now() - start;
    if (time < FAST_OBJECT_TIME) {
      size = Math.min(size * 2, BIGGEST_OBJECT_SIZE);
    }
  }
}

// Runs a download or upload test. Shows the speed live and returns
// { speed: Mbps, bytes: total data transferred }.
async function measureSpeed(transferOne, speedElement, dataElement) {
  test = { running: true, bytes: 0, openRequests: [] };
  const startTime = performance.now();

  // Start all connections at the same time.
  let error = null;
  const connections = [];
  for (let i = 0; i < CONNECTIONS; i++) {
    connections.push(runConnection(transferOne));
  }
  const allFinished = Promise.all(connections).catch((e) => {
    error = e;
    stopTest();
  });

  const history = [{ time: startTime, bytes: 0 }]; // byte count at every check
  const readings = [];                              // speeds measured after warm-up
  let finalSpeed = 0;

  while (test.running) {
    await wait(CHECK_EVERY);
    const now = performance.now();
    history.push({ time: now, bytes: test.bytes });

    // Speed over the last second.
    const oneSecondAgo = history[Math.max(0, history.length - 1 - READINGS_PER_SECOND)];
    const speed = toMbps(test.bytes - oneSecondAgo.bytes, now - oneSecondAgo.time);

    speedElement.textContent = speed.toFixed(1);
    dataElement.textContent = toMB(test.bytes);

    const elapsed = now - startTime;
    if (elapsed >= WARM_UP_TIME) {
      readings.push(speed);
    }

    const lastReadings = readings.slice(-READINGS_TO_COMPARE);
    const stable = lastReadings.length === READINGS_TO_COMPARE && isStable(lastReadings);

    if (stable || elapsed >= MAX_TEST_TIME) {
      finalSpeed = lastReadings.length > 0 ? average(lastReadings) : speed;
      stopTest();
    }
  }

  await allFinished;
  if (error) throw error;

  speedElement.textContent = finalSpeed.toFixed(1);
  dataElement.textContent = toMB(test.bytes);
  return { speed: finalSpeed, bytes: test.bytes };
}

// ----- Start button -----

async function startSpeedTest() {
  startButton.disabled = true;
  pingValue.textContent = "--";
  downloadValue.textContent = "--";
  uploadValue.textContent = "--";
  downloadData.textContent = "0.00 MB";
  uploadData.textContent = "0.00 MB";
  summaryText.textContent = "";
  const testStart = performance.now();

  try {
    statusText.textContent = "Step 1 of 3: measuring ping...";
    const ping = await measurePing();
    pingValue.textContent = ping.toFixed(1);

    statusText.textContent = "Step 2 of 3: measuring download speed...";
    const download = await measureSpeed(downloadOne, downloadValue, downloadData);

    statusText.textContent = "Step 3 of 3: measuring upload speed...";
    if (uploadBlob === null) {
      uploadBlob = makeRandomBlob(BIGGEST_OBJECT_SIZE);
    }
    const upload = await measureSpeed(uploadOne, uploadValue, uploadData);

    const totalSeconds = (performance.now() - testStart) / 1000;
    statusText.textContent = "Test complete";
    summaryText.textContent =
      "Total time: " + totalSeconds.toFixed(1) + " s, total data: " +
      toMB(download.bytes + upload.bytes);
  } catch (error) {
    statusText.textContent = "Test failed: " + error.message;
  } finally {
    startButton.disabled = false;
  }
}

startButton.addEventListener("click", startSpeedTest);

# Speed Test

A website that measures your **ping**, **download speed** and **upload speed**,
and shows how much data each test used.

- **Course:** CS 568 Contemporary Topics in Networking
- **Instructor:** Ali C. Begen
- **Team:** Uğurcan Yılmaz, Damla Şahin
- **Live site:** https://speedtest.ugurcanyilmaz.com

## Requirements

- Go 1.22 or newer (https://go.dev/dl). Nothing else: the server uses only Go's standard library,
  and the page uses plain HTML, CSS and JavaScript (no libraries).
- Any modern browser (Chrome, Firefox, Edge, Safari).

## How to run (on your own computer)

```
go run .
```

Then open http://localhost:8080 and click **Begin Speed Test**.

- Another port: `PORT=9000 go run .` (Linux/macOS), or `set PORT=9000` and then `go run .` (Windows).
- To build one program file: `go build -o speedtest .` and run `./speedtest`.
  Start it in this folder, because it serves the `static` folder.

Note: when the browser and the server are on the same computer, the results are not real
internet speeds (the data never leaves the computer). Use a server on the internet for real tests.

## Files

| File | What it does |
|------|--------------|
| `main.go` | Go web server: serves the website and the `/ping`, `/download`, `/upload` endpoints |
| `static/index.html` | The page |
| `static/app.js` | The speed test itself (runs in the browser) |
| `static/style.css` | Page style (dark theme, progress bar) |
| `.devcontainer/devcontainer.json` | Setup for GitHub Codespaces (Go installed, port 8080 forwarded) |

## How the test works

1. **Ping:** the browser sends 10 small requests to `/ping` and shows the lowest
   round-trip time in milliseconds. One extra request is sent first and not counted,
   because it also has to open the connection.
2. **Download:** the browser downloads random data from `/download?size=...` over
   **6 connections at the same time** (the most HTTP/1.1 connections a browser opens to one
   site). Each connection downloads objects one after another, and the speed is calculated
   from the total bytes of all connections.
3. **Upload:** the same, but the browser sends random data to `/upload`.

For download and upload:

- Each connection starts with a small object (100 KB). If an object finishes in
  less than 250 ms, the next one is twice as big (up to 8 MB). So a slow line doesn't
  wait for huge objects, and a fast line doesn't waste time on tiny ones.
- Every 250 ms the speed over the last second is calculated and shown.
- The first second is ignored, because TCP starts slowly.
- The test stops as soon as the last 4 readings are within 10% of each other
  (the speed is stable), or after 8 seconds at most. Unfinished transfers are
  cancelled so no extra data is wasted.
- The result is the average of those last 4 readings, in Mbps (megabits per second).
- The amount of data downloaded and uploaded is shown under each result, in MB,
  and the total time and total data are shown at the end.

The number of connections can be changed for experiments in the address bar,
for example `/?connections=1` or `/?connections=4`.

## Our server setup (AWS)

The live site runs on an AWS EC2 `t3.micro` server with Ubuntu in Europe (Stockholm), `eu-north-1`.
The domain `speedtest.ugurcanyilmaz.com` is an A record in Cloudflare, set to **DNS only**
(not proxied), so the test measures our server and not Cloudflare.

## Results

Measured from Istanbul (TurkNet, about 1 Gbps) to our server in Stockholm.
Each value is the average of 3 runs.

| Step | Change | Connections | Download (Mbps) | Upload (Mbps) |
|------|--------|-------------|-----------------|---------------|
| 1 | First version | 1 | 112.6 | 134.8 |
| 2 | Multiple connections, HTTP/2 still on | 6 | 110.2 | 159.6 |
| 3 | HTTP/2 turned off | 6 | 347.5 | 814.8 |
| 4 | BBR turned on | 6 | 704.9 | 870.0 |
| 5 | Bigger TCP buffers | 6 | 709.2 | 924.3 |

## Comparison with other speed tests

Run from the same PC and network. Ookla was set to the server closest to ours
(AltusHost B.V., Stockholm).

| Tool | Server | Ping (ms) | Download (Mbps) | Upload (Mbps) | Data used (MB) |
|------|--------|-----------|-----------------|---------------|----------------|
| Our test (6 connections) | AWS, Stockholm | 55.9 | 727.3 | 854.7 | 574.45 |
| Ookla Speedtest | AltusHost B.V., Stockholm | 56 | 244.16 | 836.22 | not shown |
| Ookla Speedtest | Mank Teknoloji A.S., Istanbul | 3 | 928.42 | 941.83 | not shown |

Our ping and upload are close to Ookla's on the Stockholm server. Our download is higher,
probably because the two tests take different routes from Turkey to Stockholm. The Istanbul
result is higher because that server is much closer to us.
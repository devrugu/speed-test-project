# Speed Test

A website that measures your **ping**, **download speed** and **upload speed**,
and shows how much data each test used.

Team: _Name Surname_, _Name Surname_

## Requirements

- Go 1.22 or newer (https://go.dev/dl). Nothing else; the server uses only Go's standard library.
- Any modern browser (Chrome, Firefox, Edge, Safari).

## How to run

```
go run .
```

Then open http://localhost:8080 and click **Begin Speed Test**.

To use another port: `PORT=9000 go run .` (Linux/macOS) or `set PORT=9000` then `go run .` (Windows).

To build a single program file instead: `go build -o speedtest .` and run `./speedtest`
(it must be started in this folder, because it serves the `static` folder).

## Files

| File | What it does |
|------|--------------|
| `main.go` | Go web server: serves the website and the `/ping`, `/download`, `/upload` endpoints |
| `static/index.html` | The page |
| `static/app.js` | The speed test itself (runs in the browser) |
| `static/style.css` | Page style |

## How the test works

1. **Ping:** the browser sends 10 small requests to `/ping` and shows the lowest
   round-trip time in milliseconds. One extra request is sent first and not counted,
   because it also has to open the connection.
2. **Download:** the browser downloads random data from `/download?size=...`
   over 4 connections at the same time (one connection alone can't fill a fast line).
3. **Upload:** the same, but the browser sends random data to `/upload`.

For download and upload:

- Every connection starts with a small object (100 KB). If an object finishes in
  less than 250 ms, the next one is twice as big (up to 8 MB). So a slow line doesn't
  wait for huge objects, and a fast line doesn't waste time on tiny ones.
- Every 250 ms the speed over the last second is calculated and shown.
- The first second is ignored, because TCP starts slowly.
- The test stops as soon as the last 4 readings are within 10% of each other
  (the speed is stable), or after 8 seconds at most. Unfinished transfers are
  cancelled so no extra data is wasted.
- The result is the average of those last 4 readings, in Mbps (megabits per second).
- The amount of data downloaded / uploaded is shown under each result, in MB.

This keeps the test short and the data use low while still giving an accurate result.

## Comparison with other speed tests

| Tool | Ping (ms) | Download (Mbps) | Upload (Mbps) |
|------|-----------|-----------------|---------------|
| Our test | | | |
| speedtest.net | | | |
| fast.com | | | |

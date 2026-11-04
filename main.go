// Speed test web server.
//
// It serves the website (the "static" folder) and three test endpoints:
//
//	/ping                 -> empty reply, used to measure round-trip time
//	/download?size=BYTES  -> sends BYTES of random data
//	/upload               -> receives data, throws it away, replies with the byte count
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
)

// maxSize is the biggest object (in bytes) a browser can download or upload at once.
const maxSize = 10_000_000 // 10 MB

// randomData is sent again and again as download data.
// We use random bytes so nothing on the way can compress them.
var randomData = make([]byte, 1_000_000) // 1 MB

// pingHandler answers immediately with an empty response.
func pingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// downloadHandler sends "size" bytes of random data, e.g. /download?size=500000
func downloadHandler(w http.ResponseWriter, r *http.Request) {
	size, err := strconv.Atoi(r.URL.Query().Get("size"))
	if err != nil || size <= 0 || size > maxSize {
		http.Error(w, "size must be between 1 and 10000000", http.StatusBadRequest)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(size))

	// Write the 1 MB random block as many times as needed.
	for size > 0 {
		n := min(size, len(randomData))
		if _, err := w.Write(randomData[:n]); err != nil {
			return // the browser stopped the download, which is normal at the end of a test
		}
		size -= n
	}
}

// uploadHandler reads everything the browser sends and replies with how many bytes arrived.
func uploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}

	body := http.MaxBytesReader(w, r.Body, maxSize)
	receivedBytes, err := io.Copy(io.Discard, body)
	if err != nil {
		return // the browser stopped the upload, or it was too big
	}

	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, receivedBytes)
}

func main() {
	rand.Read(randomData)

	// The port can be changed with the PORT environment variable (default 8080).
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/ping", pingHandler)
	http.HandleFunc("/download", downloadHandler)
	http.HandleFunc("/upload", uploadHandler)
	http.Handle("/", http.FileServer(http.Dir("static")))

	log.Println("Speed test server running on http://localhost:" + port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

// Package main is the speed test web server.
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
)

// serverAddress is the network port the server listens on.
const serverAddress = ":8080"

// staticFolder holds the website files sent to the browser.
const staticFolder = "static"

// randomBlockSize is the size in bytes of the block of test data kept in memory.
const randomBlockSize = 1_000_000

// maxObjectSize is the largest object in bytes a client can download or upload.
const maxObjectSize = 25_000_000

// randomBlock holds random bytes that are sent repeatedly as download data.
var randomBlock = make([]byte, randomBlockSize)

// handlePing replies straight away with an empty response, so the browser
// can time one round trip to the server.
func handlePing(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(http.StatusNoContent)
}

// handleDownload sends the number of random bytes given by the "size" query
// parameter, for example /download?size=1000000.
func handleDownload(writer http.ResponseWriter, request *http.Request) {
	size, err := strconv.Atoi(request.URL.Query().Get("size"))
	if err != nil || size <= 0 || size > maxObjectSize {
		http.Error(writer, "Invalid size", http.StatusBadRequest)
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/octet-stream")
	writer.Header().Set("Content-Length", strconv.Itoa(size))

	// Send the object in chunks until every requested byte has been written.
	remainingBytes := size
	for remainingBytes > 0 {
		chunkSize := min(remainingBytes, randomBlockSize)
		if _, err := writer.Write(randomBlock[:chunkSize]); err != nil {
			return
		}
		remainingBytes -= chunkSize
	}
}

// handleUpload reads all the data sent by the browser, throws it away and
// replies with the number of bytes received.
func handleUpload(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "Use POST", http.StatusMethodNotAllowed)
		return
	}

	limitedBody := http.MaxBytesReader(writer, request.Body, maxObjectSize)
	receivedBytes, err := io.Copy(io.Discard, limitedBody)
	if err != nil {
		http.Error(writer, "Upload too large", http.StatusRequestEntityTooLarge)
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(writer, receivedBytes)
}

func main() {
	rand.Read(randomBlock)

	http.HandleFunc("/ping", handlePing)
	http.HandleFunc("/download", handleDownload)
	http.HandleFunc("/upload", handleUpload)
	http.Handle("/", http.FileServer(http.Dir(staticFolder)))

	log.Println("Server started at http://localhost" + serverAddress)
	log.Fatal(http.ListenAndServe(serverAddress, nil))
}

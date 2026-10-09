// Command costan-replay-trim rewrites a replay file so it contains only the
// frames that change the board: something placed, built or moved. Rolls,
// trades, discards, draws and other bookkeeping are dropped.
//
//	go run ./cmd/costan-replay-trim -in frontend/replay-live.frames.json \
//	    -out frontend/public/replay-attract.frames.json
//
// Each frame carries the whole spectator view after its event (replay.Frame),
// not a delta, so dropping frames is safe and nothing is reconstructed here.
//
// Used for the homepage attract loop: about a fifth of a base game's events
// change the board, so the file shrinks by about that factor.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/replay"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	in := flag.String("in", "-", "replay JSON to read (- for stdin)")
	out := flag.String("out", "-", "write the trimmed replay here (- for stdout)")
	keepLast := flag.Bool("keep-last", true, "always keep the final frame, so the file ends on the finished board")
	verbose := flag.Bool("v", false, "print a histogram of what was dropped")
	flag.Parse()

	raw, err := readAll(*in)
	if err != nil {
		return err
	}
	var file replay.File
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("parse %s: %w", *in, err)
	}
	if len(file.Frames) == 0 {
		return fmt.Errorf("%s: no frames", *in)
	}

	total := len(file.Frames)
	dropped := replay.Trim(&file, *keepLast)
	if len(file.Frames) == 0 {
		return fmt.Errorf("%s: nothing left after trimming; is this a game log?", *in)
	}

	data, err := json.Marshal(file)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := writeAll(*out, data); err != nil {
		return err
	}
	log.Printf("kept %d/%d frames (%.0f%%), %.2f MB",
		len(file.Frames), total, 100*float64(len(file.Frames))/float64(total), float64(len(data))/(1<<20))
	if *verbose {
		types := make([]engine.EventType, 0, len(dropped))
		for t := range dropped {
			types = append(types, t)
		}
		slices.SortFunc(types, func(a, b engine.EventType) int { return dropped[b] - dropped[a] })
		for _, t := range types {
			log.Printf("  dropped %5d %s", dropped[t], t)
		}
	}
	return nil
}

func readAll(path string) ([]byte, error) {
	if path == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}

func writeAll(path string, data []byte) error {
	if path == "-" {
		_, err := os.Stdout.Write(data)
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

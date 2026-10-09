//go:build ignore

// Generates a static first-frame PNG next to each decoration GIF, for the
// prefers-reduced-motion fallback. Run:
//
//	go run scripts/gen-decoration-stills.go <gif>...
package main

import (
	"image"
	"image/gif"
	"image/png"
	"os"
	"strings"
)

func main() {
	for _, src := range os.Args[1:] {
		f, err := os.Open(src)
		if err != nil {
			panic(err)
		}
		g, err := gif.DecodeAll(f)
		f.Close()
		if err != nil {
			panic(err)
		}
		b := g.Image[0].Bounds()
		out := image.NewRGBA(b)
		// Composite frame 0 as-is (these GIFs have a full, transparent frame 0).
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				out.Set(x, y, g.Image[0].At(x, y))
			}
		}
		dst := strings.TrimSuffix(src, ".gif") + "_static.png"
		w, err := os.Create(dst)
		if err != nil {
			panic(err)
		}
		if err := png.Encode(w, out); err != nil {
			panic(err)
		}
		w.Close()
		println("wrote", dst)
	}
}

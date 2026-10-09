package wagons

import (
	"encoding/json"
	"testing"
)

// TestViewExtPublishesCargoAsNumbers pins the cargo fields as number arrays,
// not the base64 string encoding/json makes of a []uint8.
func TestViewExtPublishesCargoAsNumbers(t *testing.T) {
	_, x := opened(t, 4, "base+wagons")
	x.Cargo[1] = CargoGlass
	raw, err := json.Marshal(x.ViewExt(1))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Cargo []int `json:"cargo"`
		Trade []struct {
			Accepts []int `json:"accepts"`
			Ships   []int `json:"ships"`
		} `json:"trade"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("cargo/accepts/ships are not JSON arrays of numbers: %v\n%s", err, raw)
	}
	if len(got.Cargo) != 4 || got.Cargo[1] != int(CargoGlass) {
		t.Fatalf("cargo = %v, want seat 1 carrying %d", got.Cargo, CargoGlass)
	}
	if len(got.Trade) != tradeHexCount {
		t.Fatalf("%d trade hexes on the wire, want %d", len(got.Trade), tradeHexCount)
	}
	for i, tr := range got.Trade {
		if len(tr.Accepts) == 0 || len(tr.Ships) != 2 {
			t.Fatalf("trade[%d] accepts %v ships %v", i, tr.Accepts, tr.Ships)
		}
	}
}

// TestViewPublishesTheTrackTheBoardDrives pins `mp_track` to the allowance the
// engine gives at every board size; the client's movement bar reads only it.
func TestViewPublishesTheTrackTheBoardDrives(t *testing.T) {
	for _, players := range []int{4, 6, 8} {
		s, x := opened(t, players, "base+wagons")
		raw, err := json.Marshal(x.ViewExt(0))
		if err != nil {
			t.Fatal(err)
		}
		var got struct {
			Track []int `json:"mp_track"`
		}
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		if len(got.Track) != maxLevel {
			t.Fatalf("%dp: mp_track %v", players, got.Track)
		}
		for level := 1; level <= maxLevel; level++ {
			if want := allowance(s, level); got.Track[level-1] != want {
				t.Fatalf("%dp level %d: view %d MP, engine %d (track %v)",
					players, level, got.Track[level-1], want, got.Track)
			}
		}
	}
}

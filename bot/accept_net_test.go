package bot

import "testing"

func TestAcceptNetLoads(t *testing.T) {
	n, err := acceptNet.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(n.Names) != acceptFeatures {
		t.Fatalf("net declares %d features, code builds %d", len(n.Names), acceptFeatures)
	}
	// The order is the contract with the trained net.
	if n.Names[0] != "give_count" || n.Names[acceptFeatures-1] != "completed_turns" {
		t.Fatalf("feature order changed: %v", n.Names)
	}
}

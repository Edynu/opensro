/*
===========================================================================

objectnav_cache_test.go - decoded adjacency preserves native neighbor order

Ownership selects the first containing neighbor. Duplicate and self edges must
retain their original position when the query's map becomes decoded metadata.

===========================================================================
*/
package movement

import (
	"reflect"
	"testing"
)

/*
================
TestObjectCellNeighborsPreserveEdgeOrder
================
*/
func TestObjectCellNeighborsPreserveEdgeOrder(t *testing.T) {
	mesh := &objectNavMesh{
		cellA: make([]uint16, 3),
		internal: objectNavEdges{
			srcCell: []uint16{0, 2, 0, 1, 0, 0xffff},
			dstCell: []uint16{2, 1, 1, 1, 2, 0},
			flags:   make([]byte, 6),
		},
	}
	want := [][]int{{2, 1, 2}, {2, 0, 1, 1}, {0, 1, 0}}
	if got := buildObjectCellNeighbors(mesh); !reflect.DeepEqual(got, want) {
		t.Fatalf("neighbor order changed: got %v, want %v", got, want)
	}
}

/*
================
TestDecodedObjectAdjacencyPreservesWalks
================
*/
func TestDecodedObjectAdjacencyPreservesWalks(t *testing.T) {
	mesh, err := decodeObjectNavPayload(deckPayload(true), 0)
	if err != nil {
		t.Fatal(err)
	}
	cached := mesh.cellNeighbors
	if cached == nil {
		t.Fatal("decoder omitted immutable adjacency")
	}
	for _, chord := range [][4]float64{
		{10, 10, 90, 90}, {90, 90, 10, 10},
		{10, 80, 80, 10}, {50, 50, 50, 50},
		{10, 10, 200, 200}, {-0.5, 10, 50, 10},
	} {
		for cell := 0; cell < mesh.cellCount(); cell++ {
			stand := &objectDeckStand{mesh: mesh, cellIndex: cell}
			mesh.cellNeighbors = cached
			got := traceObjectCells(stand, chord[0], chord[1], chord[2], chord[3])
			mesh.cellNeighbors = nil
			want := traceObjectCells(stand, chord[0], chord[1], chord[2], chord[3])
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("cached adjacency changed chord %v from cell %d", chord, cell)
			}
		}
	}
}

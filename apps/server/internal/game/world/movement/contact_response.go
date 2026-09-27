package movement

import "math"

type objectContactPoint struct {
	x, y, z      float64
	valid        bool
	outside      bool
	continuation bool
	// outline marks a contact on an outline edge: the reflect branch whose
	// failing leg returns 0x10000000 (403FB0). Internal side-block contacts
	// commit the clipped point instead (428930 bit 0).
	outline bool
}

func contactF32(n float64) float64 { return float64(float32(n)) }

// Original 45c1b0/40efd0: honor each stored float, including reciprocal.
func nativeCellEntry(cx, cz, x, z float64) (float64, float64) {
	f := contactF32
	dx, dz := f(f(cx)-f(x)), f(f(cz)-f(z))
	length := f(math.Sqrt(f(dx*dx + dz*dz)))
	const limit = 0.19999998807907104
	if length > limit {
		inverse := f(1 / length)
		dx = f(f(dx*inverse) * limit)
		dz = f(f(dz*inverse) * limit)
	}
	return f(f(x) + dx), f(f(z) + dz)
}

func nativeObjectContact(mesh *objectNavMesh, edges *objectNavEdges, edge int, source bool, x0, z0, y0, x1, z1 float64, reflection ...bool) objectContactPoint {
	cell := int(edges.srcCell[edge])
	if !source {
		cell = int(edges.dstCell[edge])
	}
	f := contactF32
	a, b := int(edges.vertA[edge])*3, int(edges.vertB[edge])*3
	x0, z0 = f(x0), f(z0)
	dx, dz := f(f(x1)-x0), f(f(z1)-z0)
	ex, ez := f(float64(mesh.vertices[b])-float64(mesh.vertices[a])), f(float64(mesh.vertices[b+2])-float64(mesh.vertices[a+2]))
	nx, nz := f(x0-float64(mesh.vertices[a])), f(z0-float64(mesh.vertices[a+2]))
	t := f(f(ex*nz-ez*nx) / f(ez*dx-ex*dz))
	if cell == 65535 {
		if len(mesh.vertexDirections) != len(mesh.vertices)/3 || edges.flags[edge]&1 == 0 {
			return objectContactPoint{}
		}
		x, z := outsideEdgeStart(x0, z0, f(x0+dx*t), f(z0+dz*t), float64(mesh.vertices[a]), float64(mesh.vertices[a+2]), float64(mesh.vertices[b]), float64(mesh.vertices[b+2]), mesh.vertexDirections[a/3], mesh.vertexDirections[b/3])
		return objectContactPoint{x: x, y: f(y0), z: z, valid: true, outside: true}
	}
	cx, cz := objectCellCentroid2D(mesh, cell)
	x, z := nativeCellEntry(f(cx), f(cz), f(x0+dx*t), f(z0+dz*t))
	continued := len(reflection) > 0 && reflection[0]
	if continued {
		x = f(2*f(x0+dx*t) - x)
		z = f(2*f(z0+dz*t) - z)
	}
	y, ok := objectCellPlaneYAt(mesh, cell, x, z)
	if !ok {
		y = y0
	}
	return objectContactPoint{x: x, y: f(y), z: z, valid: true, continuation: continued}
}

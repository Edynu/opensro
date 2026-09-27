package simulation

// Typed heap operations avoid boxing a 32-byte value on every callback. The
// ordering remains spawnQueue.Less, including hive and nest tie-breakers.
func (q *spawnQueue) pushTick(tick spawnTick) {
	*q = append(*q, tick)
	for child := len(*q) - 1; child > 0; {
		parent := (child - 1) / 2
		if !q.Less(child, parent) {
			break
		}
		q.Swap(child, parent)
		child = parent
	}
}

func (q *spawnQueue) popTick() spawnTick {
	n := len(*q) - 1
	result := (*q)[0]
	(*q)[0] = (*q)[n]
	(*q)[n] = spawnTick{}
	*q = (*q)[:n]
	for parent := 0; ; {
		child := 2*parent + 1
		if child >= n {
			break
		}
		if child+1 < n && q.Less(child+1, child) {
			child++
		}
		if !q.Less(child, parent) {
			break
		}
		q.Swap(parent, child)
		parent = child
	}
	return result
}

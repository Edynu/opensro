package monster

func (instance Instance) RememberedOpponents() [2]uint32 {
	return [2]uint32{instance.Opponents[0].GID, instance.Opponents[1].GID}
}

// Package texttable owns detached cells for immutable textdata catalogues.
package texttable

import "strings"

// Cells deduplicates cells during one file load. A stored name must not keep
// an entire decoded textdata file alive through a substring backing pointer.
type Cells map[string]string

func (c Cells) Split(line string) []string {
	fields := strings.Split(line, "\t")
	for i, field := range fields {
		if value, ok := c[field]; ok {
			fields[i] = value
		} else {
			value := strings.Clone(field)
			c[value] = value
			fields[i] = value
		}
	}
	return fields
}

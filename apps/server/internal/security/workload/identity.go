// Package workload verifies Nomad workload identity for Agent control calls.
package workload

import (
	"context"
)

const NomadAgentAudience = "sro-agent"

// IdentityClaims are the Nomad-controlled identity fields Agent uses
// to authorize GameWorld control calls.
type IdentityClaims struct {
	Namespace    string `json:"nomad_namespace"`
	JobID        string `json:"nomad_job_id"`
	AllocationID string `json:"nomad_allocation_id"`
	Task         string `json:"nomad_task"`
}

type IdentityVerifier interface {
	Verify(context.Context, string) (IdentityClaims, error)
}

namespace "sro" {
  capabilities = [
    "list-jobs",
    "parse-job",
    "plan-job",
    "read-job",
    "submit-job",
  ]

  variables {
    path "nomad/jobs/sro-agent/agent/agent" {
      capabilities = ["destroy", "list", "read", "write"]
    }

    path "nomad/jobs/sro-agent/agent/agent/accounts/*" {
      capabilities = ["destroy", "list", "read", "write"]
    }

    path "nomad/jobs/sro-gameworld-*/gameworld/gameworld" {
      capabilities = ["destroy", "list", "read", "write"]
    }

    path "sro/operations/fleet" {
      capabilities = ["list", "read", "write"]
    }
  }
}
